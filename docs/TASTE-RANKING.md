# Taste ranking — how Home decides what comes first

Feature flag: **`taste_ranking`** (default off). With it off nothing in this
document is active: Home is newest-first, cards carry no match line, Edit
profile has no tag picker. Turn it on from Settings → Feature flags (admin).

## The promise, in code

"Follow your taste, not the numbers." The ranking takes exactly two kinds of
input: what the viewer said they like, and what an Edit is about. Its input
type (`RankableItem` in `artifacts/api-server/src/lib/taste-ranking.ts`)
has no field for likes, saves, views or followers, so a count cannot be
used even by accident, and `scripts/tests/taste-ranking.test.mjs` plus
`verify:taste-ranking` assert that adding thousands of likes, saves and
followers to a creator does not move the order by one place.

## What a viewer has

The taste profile from onboarding / Tune Taste: at least 1 category and
2 tags from the catalog (`lib/taste-catalog`). Without a complete profile,
or signed out, Home stays newest-first even with the flag on.

## What an Edit has

- its category (chosen by the creator), and
- its **taste tags**: inferred from the words of its title and caption
  (English and Arabic keyword lists per tag in the catalog, up to 4 tags,
  the Edit's own category first), plus the **tags the creator picked on
  their profile** (up to 8, Edit profile → Taste tags). Computed at read
  time; nothing derived is stored.

## The score (0–100)

`35 × [Edit category is one of the viewer's categories] + 65 × Jaccard(viewer tags, Edit tags)`

The same 35/65 weights as the creator-level Taste Match, so the two numbers
agree. The creator-level match now uses the creator's picked tags plus the
tags inferred from all their published Edits; a creator with no tags at all
is scored on categories alone instead of being capped at 35%.

## The order

1. score, highest first;
2. newest first on ties (creator workspace update time; Edits have no
   timestamp of their own yet);
3. a diversity pass: the same creator never appears twice in a row while
   another creator's Edit is still available further down (it is pulled
   forward; nothing is dropped or hidden).

Following and My Circle stay chronological. Explore creators keep "best"
(match score, then newest) when signed in.

## What the viewer sees

Under the creator name on a Home card: "Matches your taste: coffee stops,
restaurants" / "يطابق ذوقك: محطات القهوة، مطاعم" — the shared tastes, never a
percentage or a count. Cards without a shared taste show no line.

## Privacy

No new data is stored. The viewer's taste profile already existed; creator
tags are part of the creator's public profile JSON.

## Testing

- Unit: `node --test scripts/tests/taste-inference.test.mjs scripts/tests/taste-ranking.test.mjs`
- Real API + disposable DB: `DATABASE_URL=… pnpm --filter scripts run verify:taste-ranking`
  (flag off/on behaviour, diversity, "never by the numbers", Taste Match above 35%)
- Web: `e2e/taste-ranking.spec.ts` (match line EN/AR, picker on/off, save body, RTL)
