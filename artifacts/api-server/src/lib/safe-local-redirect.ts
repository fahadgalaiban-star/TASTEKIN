/** Redirect only to an app-relative URL, never a browser-normalized authority. */
export function safeLocalRedirect(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")
    || /[\\\u0000-\u0020\u007f]/.test(value)) return "/";
  try {
    const base = "https://local.invalid";
    const target = new URL(value, base);
    // Dot-segment normalization can produce a pathname such as "//host" from
    // "/folder/..//host". Revalidate the serialized relative result as well.
    if (target.origin !== base || target.username || target.password || target.pathname.startsWith("//")) return "/";
    return target.pathname + target.search + target.hash;
  } catch { return "/"; }
}