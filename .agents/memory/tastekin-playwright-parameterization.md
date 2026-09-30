---
name: TASTEKIN Playwright parameterization
description: How to register parameterized browser tests in the project's Playwright runner.
---

Register parameterized Playwright cases with a loop around `test(...)`, not `test.each`.

**Why:** The project's Playwright runtime throws `TypeError: test.each is not a function` during test discovery. The app's typecheck does not cover browser-test files, so it cannot catch this.

**How to apply:** When adding a matrix of browser cases, define each case in a `for ... of` loop and run focused Playwright tests to confirm discovery and execution.