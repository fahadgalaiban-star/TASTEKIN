/** Exact methods and paths only; never grant ordinary application access. */
export function suspendedAccountAccess(method: string, path: string): boolean {
  const route = path.startsWith("/api/") ? path.slice(4) : path;
  return (method === "GET" && ["/me", "/auth/user", "/logout", "/privacy", "/terms", "/support"].includes(route))
    || (method === "POST" && ["/me/delete-account", "/auth/native/logout", "/auth/native/logout-all"].includes(route));
}