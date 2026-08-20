---
name: TASTEKIN reference assets
description: Coordinate handling for supplied TASTEKIN UI reference PNGs.
---

The supplied TASTEKIN UI references are retina-resolution screenshots (1080×1920), even when rendered around 576×1024 in previews.

**Why:** Cropping by the visually displayed dimensions captures surrounding interface elements instead of the intended photo regions. Source screenshots also embed interface chrome, labels, and overlays around their photos.

**How to apply:** When deriving local media crops from these references, inspect the image’s physical dimensions first and calculate crop coordinates from that resolution. Keep every crop inside the photo area, excluding embedded labels, buttons, badges, and avatar rings.