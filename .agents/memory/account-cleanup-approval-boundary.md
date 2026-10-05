---
name: Account cleanup approval boundary
description: User-imposed safety limits for account-deletion media cleanup work.
---

For account-deletion media cleanup work, use only disposable PostgreSQL under `/tmp` and mocked providers for verification. Do not use real accounts, real storage, or managed databases. Preparing a cleanup runner does not authorize running it against live data, scheduling it, or publishing the changes.

**Why:** The user explicitly prohibited real accounts/storage/managed databases, scheduling, and deployment for this work.

**How to apply:** Preserve these limits for cleanup follow-ups unless the user separately authorizes broader operations. Do not treat readiness of the runner as approval to execute it.
