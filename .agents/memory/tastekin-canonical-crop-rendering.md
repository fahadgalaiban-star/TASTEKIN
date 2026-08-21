---
name: TASTEKIN canonical crop rendering
description: Ensures creator crop previews and consumer surfaces preserve the same rendered framing.
---

Use one rendered canvas rendition as the source of truth after a creator confirms a crop. Consumer cards, profile grids, Edit detail, and composer preview must display that rendition at its stored output aspect ratio; they must not apply a second centered cover crop.

**Why:** CSS transforms in an editor and independent `object-fit: cover` rendering on public surfaces can make a creator-approved framing shift or reset after publishing.

**How to apply:** Preserve the approved crop metadata with one of the exact output format tuples, generate the final rendition during crop confirmation, and use its output dimensions for every image frame downstream.