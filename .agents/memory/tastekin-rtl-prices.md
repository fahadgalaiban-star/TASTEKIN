---
name: TASTEKIN RTL numerals
description: Prevent bidirectional text from reversing the visible order of Latin numerals in Arabic UI.
---

Render Latin numeral tokens in Arabic subscription labels with an explicit left-to-right bidi isolation, while leaving the Arabic sentence RTL.

**Why:** Plain mixed-direction text can visually reorder Latin numerals and punctuation despite the source string being correct.

**How to apply:** Use a `bdi` element with `dir="ltr"` around the numeral token whenever it appears inside Arabic copy, then visually verify the rendered label at the mobile viewport.