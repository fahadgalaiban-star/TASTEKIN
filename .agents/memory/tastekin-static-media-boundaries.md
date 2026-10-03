---
name: TASTEKIN static media boundaries
description: Why API visibility checks cannot revoke all packaged or previously delivered media.
---

Treat public API moderation and direct-asset revocation as separate guarantees.
Do not promise that an Express static-file guard protects packaged images served
by the platform's static artifact handler.

**Why:** The platform registers the frontend public directory as its own static
handler, ahead of the API process. Requests for packaged content images can
bypass Express entirely. Previously issued third-party URLs and offline copies
also remain outside an API response projection.

**How to apply:** Before promising complete media revocation, review artifact
routing and move content images outside the public asset directory behind a
moderation-aware API. Keep this separate from creator editing: preserved private
originals must never become a public-feed fallback when the moderated feed is
empty or unavailable.