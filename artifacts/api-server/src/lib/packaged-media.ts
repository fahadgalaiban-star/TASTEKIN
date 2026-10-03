import path from "node:path";

declare const __dirname: string;
export const packagedMediaDirectory = typeof __dirname === "string"
  ? path.resolve(__dirname, "media")
  : path.resolve(import.meta.dirname, "../../dist/media");

/** Stable app-origin inventory, independent of the hostname used for this request. */
export function trustedMediaOrigins(requestOrigin?: string): Set<string> {
  const origins = new Set<string>();
  const configured = process.env.ALLOWED_ORIGINS ||
    "http://localhost:23385,http://127.0.0.1:23385,http://localhost:8080,http://127.0.0.1:8080";
  for (const candidate of [...configured.split(","), ...(requestOrigin ? [requestOrigin] : [])]) {
    const url = new URL(candidate.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("Invalid configured media origin");
    origins.add(url.origin);
  }
  return origins;
}

/** Canonical identity for our flat packaged-media namespace; reject aliases/traversal. */
export function packagedMediaReference(value: string, trustedOrigins?: ReadonlySet<string>): string | undefined {
  try {
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid" && !trustedOrigins?.has(url.origin)) return undefined;
    const decoded = decodeURIComponent(url.pathname);
    if (!/^\/tastekin-media\/[\w-][\w.-]*\.(webp|png|jpg|jpeg)$/i.test(decoded)
      || decoded.includes("..")) return undefined;
    return `/tastekin-media/${decoded.slice(decoded.lastIndexOf("/") + 1)}`;
  } catch { return undefined; }
}

/** Extract URL candidates first; then decode identity and discard prose punctuation. */
export function packagedMediaLinks(text: string, origins: ReadonlySet<string>): string[] {
  const references: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'()]+|(?<![\w:/])\/tastekin-media\/[^\s<>"'()]+/gi)) {
    const candidate = match[0].replace(/[.,;:!?\]]+$/, "");
    const reference = packagedMediaReference(candidate, origins);
    if (reference) references.push(reference);
  }
  return references;
}