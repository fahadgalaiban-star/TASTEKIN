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

Taste ranking itself stores no new data. The viewer's taste profile already
existed; creator tags are part of the creator's public profile JSON. Taste
learning (below) stores two new things, listed in its own privacy section.

## Taste learning — Home learns from what the member does

Feature flag: **`taste_learning`** (default off; it only does anything while
`taste_ranking` is also on). Off: nothing below runs, the "Not interested"
menu item and route do not exist, and no dwell event is sent.

Code: `artifacts/api-server/src/lib/taste-learning.ts` (pure learner),
`taste-learning-signals.ts` (the database reads), `scoreEditWithLearning`
in `taste-ranking.ts` (the blend).

### Signals, all the member's own

| Signal | Weight | Where it comes from |
| --- | --- | --- |
| Save | 3 | `edit_saves` |
| Circle membership | 3, split across the creator's tags | `my_circle_memberships` |
| Like | 2 | `edit_likes` |
| Follow | 2, split across the creator's tags | `creator_follows` |
| Time on screen ("dwell") | up to 1 (full at 20 s) | `analytics_events` named `edit_dwell` |
| View | 0.5, at most 3 views per creator | `creator_view_events` with an Edit id |
| Not interested | −4 | `edit_dismissals` |

Every row is filtered by the viewer's own user id. Nothing another member
did is ever read, and no count of anything is computed: `TasteSignal` has
no count field, and the test "never by the numbers" permutes thousands of
other members' likes, saves and follows on a creator and asserts the
viewer's order does not move.

### How it changes the order

1. Signals from the last **90 days** count, halving every **30 days**
   (a 90-day-old save is worth an eighth of a fresh one). Follows and
   Circle are standing relationships and count at full weight.
2. Each signal votes for the tags and category of the Edit (or the
   creator's picked tags and categories, for follow/Circle).
3. The top tags (max 6) and categories (max 2) with at least 1 point of
   weight form an **implicit taste selection**. It needs at least one
   category and two tags before it is used; until then Home is exactly
   the explicit-taste order.
4. Score = **60 % explicit** (the member's picks) **+ 40 % implicit**,
   through the same 35/65 category/tag scorer. The explicit taste always
   leads; behaviour tilts within it.
5. A tag that fell to −2 or lower (two "Not interested" on Edits sharing
   it, or one plus decay) is **rejected**: Edits sharing it lose 15 points
   each, never below 0.
6. An Edit the member marked "Not interested" is removed from their Home
   entirely. Dismissals do not decay.

The same order, diversity pass and "Matches your taste" line as taste
ranking apply afterwards. Learned shared tastes appear in that line too.

### What the member sees

- Edit detail → More options → **Not interested** / **لا يهمني** (signed in,
  not their own Edit). The Edit disappears from Home at once. It is not a
  report and the creator is never told.
- Nothing else: no "because you saved…" explanations yet, no numbers.

### Privacy — what is new

- `edit_dismissals` (migration `0025_edit_dismissals`): who hid which Edit,
  with the creator id and a timestamp. Per member, never aggregated, never
  shown to the creator, removed on account deletion.
- `edit_dwell` analytics events: Edit id, whole seconds on screen (2–60),
  and the surface (`home`). Sent only while the flag is on and the member is
  signed in. Same retention as other analytics events.
- The Privacy Policy lists both under "Taste signals" and "To rank your
  feeds by taste"; the policy's effective date moves when the founder turns
  the flag on (the Terms date is unchanged). App Privacy: Usage Data →
  Product Interaction gains the purpose **Product Personalization**.

### Schema change, production

`edit_dismissals` reaches Production only through the documented workflow:
merge → dev `push` → read the Publish diff (expect one `CREATE TABLE` and
one `CREATE INDEX`, nothing else) → approve. The migration file is never
run against Production.

## Testing

- Unit: `node --test scripts/tests/taste-inference.test.mjs scripts/tests/taste-ranking.test.mjs scripts/tests/taste-learning.test.mjs`
- Real API + disposable DB: `DATABASE_URL=… pnpm --filter scripts run verify:taste-ranking`
  (flag off/on behaviour, diversity, "never by the numbers", Taste Match above 35%)
  and `verify:taste-learning` (flag off → no learning, route 404; own saves/likes/follow
  move only the viewer's Home; Not interested hides + penalises; owner refused; dwell
  shape validation; never by the numbers; deletion cleanup)
- Web: `e2e/taste-ranking.spec.ts` (match line EN/AR, picker on/off, save body, RTL)
  and `e2e/taste-learning.spec.ts` (Not interested EN/AR, hidden with flag off and
  signed out, one `edit_dwell` per card stay, none with the flag off)
