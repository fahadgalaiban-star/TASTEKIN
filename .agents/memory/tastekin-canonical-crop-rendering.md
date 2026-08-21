---
name: TASTEKIN canonical crop rendering
description: Ensures creator crop previews and consumer surfaces preserve the same rendered framing.
---

Use one rendered canvas rendition as the source of truth after a creator confirms a crop. The cropper must start every format at its calculated minimum cover scale, clamp dragging to image bounds, and render image pixels across the whole canvas. Consumer cards, profile grids, Edit detail, and composer preview must display that rendition at its stored output aspect ratio; they must not apply a second centered crop or letterbox it with `contain`.

**Why:** CSS transforms in an editor and independent public rendering can make a creator-approved framing shift or reset after publishing. Allowing a source image below its cover scale adds visible blank sidebars in tall formats.

**How to apply:** Preserve the approved crop metadata with one of the exact output format tuples, calculate `max(frameWidth/sourceWidth, frameHeight/sourceHeight)` whenever format changes, generate the final rendition during crop confirmation, and use its output dimensions for every image frame downstream.