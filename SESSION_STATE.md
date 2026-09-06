# SESSION STATE
Updated: 2026-09-06
Last verified commit: main after PR #34
Live URL verified: PARTIAL

## Now
PR #32 (Looks), #33 (Travel), #34 (instructions file)
all merged. #32 and #33 published live.

Verified live: Looks reference images, no web images
in look cards, "Get new suggestions" label, Travel
4-step form, duplicate location field removed.

## Blocked
None.

## Next action
One KIN Travel request to London. Confirm leg times
read as driving (35km should be ~45min, not 492), that
stops are ordered geographically with no out-and-back
to Watford, and that no model deliberation text
appears. Daily limit (50) blocked this yesterday.

## Open questions
- Looks replies follow query language; Travel follows
  UI locale. Decide after real users.
- Shopping links need a product data source. Web
  search returns articles, not products. Blocked on
  company formation, same as Stripe Connect.

## Not yet ported from handoff/claude-code-2026-09-05
- link-preview.ts logo/social-image filtering
- `partial` result state
- correlation ID logging
