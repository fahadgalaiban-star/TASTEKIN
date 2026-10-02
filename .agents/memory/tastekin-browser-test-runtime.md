---
name: TASTEKIN browser test runtime
description: Running database-free browser checks with Replit's separately supplied Chromium.
---

Prefer the workspace-provided Chromium when running isolated browser checks; do not assume Playwright's revision-specific headless-shell download exists.

**Why:** The installed Playwright dependency can expect a browser revision that is absent even though Replit already provides a working Chromium. That launcher failure does not indicate an application defect and does not require changing application dependencies.

**How to apply:** Honor the existing REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE override, otherwise use the provided Chromium executable when present, and retain Playwright's normal launcher outside Replit. Keep these checks isolated from the application server, shared databases and real storage providers.