---
name: TASTEKIN browser E2E discovery fixtures
description: Keeping profile-to-profile browser regressions deterministic when the API workflow is unavailable to Vite test instances.
---

When a browser regression test needs to navigate to a non-Fheed creator, give that test a route-scoped `/api/explore` fixture containing the required creators.

**Why:** The app deliberately falls back to Fheed when discovery data cannot be fetched. Browser test instances may not have the API workflow available through their Vite server, so a test that depends on a second real creator becomes flaky for environmental reasons rather than product behavior.

**How to apply:** Keep the fixture local to the test that needs it, and test the actual Profile component and UI navigation after the response. Do not add runtime fallbacks, seed data, or API behavior solely for browser-test setup.