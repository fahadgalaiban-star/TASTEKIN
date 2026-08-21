---
name: TASTEKIN creator profiles
description: Durable ownership, privacy, and verification rules for creator-facing profile work.
---

Creator profile identity is part of the existing creator workspace rather than a separately owned social profile. Profile changes are restricted to the configured founder account.

**Why:** The current product has one founder-controlled creator workspace, so separate identity ownership would add conflicting access paths without a user benefit.

**How to apply:** Keep display identity, interests, avatar, and public-age preference with the creator workspace. Treat date of birth and storage object paths as private data; only calculate and expose age when the creator opts in. Verification and the Taste Seal are server-controlled states, never editable profile inputs.