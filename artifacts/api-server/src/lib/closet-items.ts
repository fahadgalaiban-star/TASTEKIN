import {
  CLOSET_CONFIRMATION_STATUSES,
  CLOSET_ITEM_TYPES,
  CLOSET_OCCASIONS,
  CLOSET_PRIMARY_COLORS,
  CLOSET_SEASONS,
  CLOSET_STYLES,
  type ClosetConfirmationStatus,
  type ClosetItemType,
  type ClosetOccasion,
  type ClosetPrimaryColor,
  type ClosetSeason,
  type ClosetStyle,
} from "@workspace/db";

const ITEM_TYPES = new Set<string>(CLOSET_ITEM_TYPES);
const PRIMARY_COLORS = new Set<string>(CLOSET_PRIMARY_COLORS);
const STYLES = new Set<string>(CLOSET_STYLES);
const OCCASIONS = new Set<string>(CLOSET_OCCASIONS);
const SEASONS = new Set<string>(CLOSET_SEASONS);
const CONFIRMATION_STATUSES = new Set<string>(CLOSET_CONFIRMATION_STATUSES);

export function isClosetItemType(value: unknown): value is ClosetItemType {
  return typeof value === "string" && ITEM_TYPES.has(value);
}
export function isClosetPrimaryColor(value: unknown): value is ClosetPrimaryColor {
  return typeof value === "string" && PRIMARY_COLORS.has(value);
}
export function isClosetStyle(value: unknown): value is ClosetStyle {
  return typeof value === "string" && STYLES.has(value);
}
export function isClosetOccasion(value: unknown): value is ClosetOccasion {
  return typeof value === "string" && OCCASIONS.has(value);
}
export function isClosetSeason(value: unknown): value is ClosetSeason {
  return typeof value === "string" && SEASONS.has(value);
}
export function isClosetConfirmationStatus(value: unknown): value is ClosetConfirmationStatus {
  return typeof value === "string" && CONFIRMATION_STATUSES.has(value);
}

const MAX_BRAND_LENGTH = 100;

/** Trims brand; empty/whitespace-only normalizes to null, never the literal string "unknown". */
export function normalizeBrand(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_BRAND_LENGTH);
}

export type ClosetItemFields = {
  itemType: ClosetItemType;
  primaryColor: ClosetPrimaryColor;
  style: ClosetStyle;
  occasion: ClosetOccasion | null;
  season: ClosetSeason | null;
  brand: string | null;
};

/** Validates the create/update body's organized fields. Returns null on any violation. */
export function validateClosetItemFields(body: unknown): ClosetItemFields | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (!isClosetItemType(record.itemType)) return null;
  if (!isClosetPrimaryColor(record.primaryColor)) return null;
  if (!isClosetStyle(record.style)) return null;
  if (record.occasion !== undefined && record.occasion !== null && !isClosetOccasion(record.occasion)) return null;
  if (record.season !== undefined && record.season !== null && !isClosetSeason(record.season)) return null;
  if (record.brand !== undefined && record.brand !== null && typeof record.brand !== "string") return null;
  return {
    itemType: record.itemType,
    primaryColor: record.primaryColor,
    style: record.style,
    occasion: (record.occasion as ClosetOccasion | null | undefined) ?? null,
    season: (record.season as ClosetSeason | null | undefined) ?? null,
    brand: normalizeBrand(record.brand),
  };
}
