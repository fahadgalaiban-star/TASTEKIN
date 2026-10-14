/** JSONB rejects escaped, unpaired UTF-16 surrogates; return a client error before writing. */
export function containsUnpairedSurrogate(value: unknown): boolean {
  if (typeof value === "string") {
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        if (i + 1 >= value.length || value.charCodeAt(++i) < 0xdc00 || value.charCodeAt(i) > 0xdfff) return true;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) {
        return true;
      }
    }
    return false;
  }
  if (Array.isArray(value)) return value.some(containsUnpairedSurrogate);
  return value !== null && typeof value === "object" && Object.values(value).some(containsUnpairedSurrogate);
}