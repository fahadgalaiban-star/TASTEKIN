import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

import {
  CLOSET_ITEM_TYPES, CLOSET_OCCASIONS, CLOSET_PRIMARY_COLORS, CLOSET_SEASONS, CLOSET_STYLES,
  type ClosetItemType, type ClosetOccasion, type ClosetPrimaryColor, type ClosetSeason, type ClosetStyle,
} from "@workspace/db";

import {
  isClosetItemType, isClosetOccasion, isClosetPrimaryColor, isClosetSeason, isClosetStyle,
} from "./closet-items";
import { WEBP_QUALITY, sanitizeErrorReason } from "./closet-media-upload";

export const DEFAULT_CLOSET_ANALYSIS_MODEL = "claude-haiku-4-5-20251001";
export const CLOSET_ANALYSIS_TIMEOUT_MS = 8_000;
export const CLOSET_ANALYSIS_MAX_DIMENSION = 1024;
const CONFIDENCE_THRESHOLD = 0.6;
const MAX_OUTPUT_TOKENS = 512;

/**
 * Lazily constructed, never at module import time — a missing
 * ANTHROPIC_API_KEY must never crash server startup. Cached after the
 * first check so a later env change within the same process is not
 * picked up (matches this repo's existing googleAuthConfigured()
 * precedent of reading configuration once per relevant check, not
 * re-reading env on every request).
 */
let cachedClient: Anthropic | null | undefined;
function anthropicClient(): Anthropic | null {
  if (cachedClient !== undefined) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  cachedClient = apiKey ? new Anthropic({ apiKey }) : null;
  return cachedClient;
}

export function isClosetAnalysisConfigured(): boolean {
  return anthropicClient() !== null;
}

function analysisModel(): string {
  return process.env.CLOSET_ANALYSIS_MODEL?.trim() || DEFAULT_CLOSET_ANALYSIS_MODEL;
}

export type ClosetSuggestionField<T extends string> = { value: T; confidence: number };
export type ClosetSuggestions = {
  itemType: ClosetSuggestionField<ClosetItemType> | null;
  primaryColor: ClosetSuggestionField<ClosetPrimaryColor> | null;
  style: ClosetSuggestionField<ClosetStyle> | null;
  occasion: ClosetSuggestionField<ClosetOccasion> | null;
  season: ClosetSuggestionField<ClosetSeason> | null;
};

export type AnalyzeClosetImageResult =
  | { status: "ok"; suggestions: ClosetSuggestions }
  | { status: "unavailable"; reason: string };

/**
 * The wire/UI-facing shape: confidence never leaves the server. The route
 * handler sends only this, never the internal ClosetSuggestions above —
 * belt-and-suspenders for "do not expose confidence numbers in the UI",
 * since a value the client never receives cannot be accidentally rendered.
 */
export type PublicClosetSuggestions = {
  itemType: ClosetItemType | null;
  primaryColor: ClosetPrimaryColor | null;
  style: ClosetStyle | null;
  occasion: ClosetOccasion | null;
  season: ClosetSeason | null;
};

export function publicClosetSuggestions(suggestions: ClosetSuggestions): PublicClosetSuggestions {
  return {
    itemType: suggestions.itemType?.value ?? null,
    primaryColor: suggestions.primaryColor?.value ?? null,
    style: suggestions.style?.value ?? null,
    occasion: suggestions.occasion?.value ?? null,
    season: suggestions.season?.value ?? null,
  };
}

const FIELD_SPECS = [
  { key: "itemType", enum: CLOSET_ITEM_TYPES, isValid: isClosetItemType },
  { key: "primaryColor", enum: CLOSET_PRIMARY_COLORS, isValid: isClosetPrimaryColor },
  { key: "style", enum: CLOSET_STYLES, isValid: isClosetStyle },
  { key: "occasion", enum: CLOSET_OCCASIONS, isValid: isClosetOccasion },
  { key: "season", enum: CLOSET_SEASONS, isValid: isClosetSeason },
] as const;

/**
 * Every field is required in the schema (the model always returns a value
 * + confidence) — the server, not the model, decides what counts as "too
 * uncertain to suggest" via CONFIDENCE_THRESHOLD in sanitizeModelOutput.
 * Brand is deliberately absent: it has no fixed taxonomy to constrain an
 * enum against, so it is never suggested.
 */
function buildResponseSchema(): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const spec of FIELD_SPECS) {
    properties[spec.key] = {
      type: "object",
      properties: {
        value: { type: "string", enum: [...spec.enum] },
        confidence: { type: "number" },
      },
      required: ["value", "confidence"],
      additionalProperties: false,
    };
  }
  return {
    type: "object",
    properties,
    required: FIELD_SPECS.map((spec) => spec.key),
    additionalProperties: false,
  };
}

const ANALYSIS_SYSTEM_PROMPT = [
  "You are analyzing a single photo of one clothing item for a private closet app.",
  "For each of the five fields, choose exactly one value from that field's allowed options that best matches what is visible in the photo, and give a confidence between 0 and 1 reflecting how certain you are — a low number for a genuinely uncertain or ambiguous case is expected and correct, not a failure.",
  "Base every value only on what is visible in the image. Never guess a brand, logo, or any text.",
  "Respond only with the structured output.",
].join(" ");

/**
 * Never a fabricated fallback: a field below CONFIDENCE_THRESHOLD, an
 * invalid enum value (defense in depth — the schema should already
 * guarantee validity, but provider/schema-compilation output is never
 * trusted blindly, same discipline as never trusting client input), or a
 * malformed shape all become `null`, never a guessed real-looking value.
 */
function sanitizeModelOutput(parsed: unknown): ClosetSuggestions | null {
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const suggestions = {} as ClosetSuggestions;
  for (const spec of FIELD_SPECS) {
    const field = record[spec.key];
    let value: ClosetSuggestionField<string> | null = null;
    if (field && typeof field === "object") {
      const candidate = field as Record<string, unknown>;
      const confidence = typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence) ? candidate.confidence : 0;
      if (spec.isValid(candidate.value) && confidence >= CONFIDENCE_THRESHOLD) {
        value = { value: candidate.value, confidence };
      }
    }
    (suggestions as Record<string, unknown>)[spec.key] = value;
  }
  return suggestions;
}

/**
 * Analyzes an already-decoded, already-sanitized (EXIF/GPS-stripped)
 * closet image buffer. Resizes an in-memory copy to a max dimension
 * purely to bound outbound image-token cost — the stored image passed in
 * is never modified or re-persisted. Never creates or updates a closet
 * item, and never persists its own result anywhere; the caller decides
 * what to do with the returned suggestions.
 */
export async function analyzeClosetImage(imageBuffer: Buffer): Promise<AnalyzeClosetImageResult> {
  const client = anthropicClient();
  if (!client) return { status: "unavailable", reason: "not configured" };

  let resized: Buffer;
  try {
    resized = await sharp(imageBuffer)
      .resize({ width: CLOSET_ANALYSIS_MAX_DIMENSION, height: CLOSET_ANALYSIS_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch (error) {
    return { status: "unavailable", reason: sanitizeErrorReason("analysis resize failed", error) };
  }

  try {
    // maxRetries: 0 — the SDK's default retry-on-timeout behavior would
    // otherwise multiply CLOSET_ANALYSIS_TIMEOUT_MS by up to 3x, defeating
    // the point of a short hard timeout on a synchronous request path the
    // frontend is waiting on.
    const response = await client.messages.create(
      {
        model: analysisModel(),
        max_tokens: MAX_OUTPUT_TOKENS,
        system: ANALYSIS_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/webp", data: resized.toString("base64") } },
              { type: "text", text: "Analyze this single clothing item photo." },
            ],
          },
        ],
        output_config: { format: { type: "json_schema", schema: buildResponseSchema() } },
      },
      { timeout: CLOSET_ANALYSIS_TIMEOUT_MS, maxRetries: 0 },
    );

    if (response.stop_reason === "refusal") return { status: "unavailable", reason: "refusal" };

    const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
    if (!textBlock) return { status: "unavailable", reason: "malformed output" };

    let parsed: unknown;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return { status: "unavailable", reason: "malformed output" };
    }

    const suggestions = sanitizeModelOutput(parsed);
    if (!suggestions) return { status: "unavailable", reason: "malformed output" };
    return { status: "ok", suggestions };
  } catch (error) {
    return { status: "unavailable", reason: sanitizeErrorReason("analysis request failed", error) };
  }
}
