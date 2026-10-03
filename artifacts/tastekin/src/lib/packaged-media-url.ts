/** Native bundles no longer contain public content media; fetch it from the gated server. */
export function packagedMediaUrl<T extends string | null | undefined>(source: T, native: boolean, apiBase: string): T {
  if (!native || !apiBase || typeof source !== "string" || !/^\/tastekin-media\//i.test(source)) return source;
  return `${apiBase.replace(/\/+$/, "")}${source}` as T;
}