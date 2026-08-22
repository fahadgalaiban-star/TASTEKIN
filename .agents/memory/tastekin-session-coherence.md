---
name: TASTEKIN session coherence
description: Rules for keeping creator and visitor UI consistent with cookie-backed authentication.
---

Use the server-backed session response as the only authority for authenticated UI, including creator ownership. Account-aware API responses must be private and non-cacheable, and a transient session refresh failure must not demote an already-known authenticated user to guest.

**Why:** A browser can retain or restore guest discovery state after an authentication callback, producing contradictory Profile and Explore experiences. Local demo-role persistence and public response caching cannot reliably reflect a cookie session.

**How to apply:** Revalidate session state on initial load, browser restore/focus/visibility, and navigation. Invalidate account-sensitive query caches only when session identity changes; identical successful revalidations should not churn the UI. Keep visitor profile preview distinct from authentication or creator permissions.