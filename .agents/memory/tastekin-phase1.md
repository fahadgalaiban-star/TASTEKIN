---
name: TASTEKIN Phase 1 delivery boundary
description: Product and implementation decisions that shape the first consumer preview.
---

Phase 1 is intentionally a consumer discovery checkpoint: onboarding, the main shell, explainable creator matching, public/locked edit presentation, collections, and persisted browser demo relationships ship before subscriber checkout, creator publishing, or admin moderation.

**Why:** The supplied plan explicitly requires a controlled stop after a new consumer can onboard, discover the canonical creator, inspect match reasons, and save/follow/trust-control content.

**How to apply:** Keep subsequent work additive; do not activate production payments or replace the seeded demo state until the Phase 1 preview is approved.

Interface language and content language are separate controls: RTL changes the UI direction, while content can independently be English, Arabic, or mixed; English content inside RTL must remain explicitly LTR.

**Why:** The product needs bilingual discovery without forcing a user's reading direction to match the language of every creator or Edit.

**How to apply:** Persist both preferences independently and localize creator/Edit data at render time; use explicit direction on usernames, search, places, products, and English cards in Arabic UI.