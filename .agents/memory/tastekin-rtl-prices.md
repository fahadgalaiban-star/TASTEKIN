---
name: TASTEKIN RTL prices
description: Prevent bidirectional text from reversing the visual order of dollar prices in Arabic UI.
---

Render the Latin currency token in Arabic subscription labels with an explicit left-to-right bidi isolation, while leaving the Arabic sentence RTL.

**Why:** Plain mixed-direction text can visually reorder `$19.99` as `19.99$`, despite the source string being correct.

**How to apply:** Use a `bdi` element with `dir="ltr"` around the currency token whenever it appears inside Arabic copy, then visually verify the rendered label at the mobile viewport.