# Store listing drafts and screenshot checklist

Drafts for App Store Connect and Google Play Console, written only from
facts already in this repository (`src/legal.ts`, `replit.md`,
`lib/taste-catalog`, `docs/MOBILE.md`, the native shells). Nothing here is a
legal entity, address, phone number, pricing, market list or rating result:
those are listed at the end as decisions the founder must supply. Every
string is a draft for review, not final copy. Character limits are the
stores' current ones at the time of writing; confirm them in the consoles.

## Facts the copy is built on

- Name `TASTEKIN`; bundle/application ID `app.tastekin`; version 1.0 (build 1).
- Free. No subscriptions, purchases, ads, paid or locked content, or payment SDKs.
- Discovery through compatible taste rather than popularity (`replit.md`).
- Taste categories: Fashion & Outfits, Travel, Places, Restaurants, Daily
  Routine, Personal Care, Health & Fitness, Decor, Books, Vlogs.
- Features named in the Privacy Policy and app: Edits (photos, videos,
  captions, place details, ratings, reviews, outfit details, links),
  collections, Taste Match, Taste Seal (admin-controlled verification),
  saves and saved lists, follows, My Circle, comments and likes, private
  messages with verified creators, KIN Looks (AI styling suggestions from
  your own clothing photos in My Things), KIN Travel (itineraries using
  Google Places/Routes), reports, blocks and mutes, two-step account deletion.
- English and Arabic with full right-to-left layout.
- Minimum age 13 (Terms of Use). Public pages: `/privacy`, `/terms`,
  `/support`, `/delete-account`. Support contact shown in the app comes from
  the `SUPPORT_EMAIL` deployment setting; the legal copy currently prints
  `support@tastekin.app`.
- Sign-in inside the native shell: email and password only (Google and Replit
  sign-in are web-only until system-browser OAuth is added).
- Shell currently targets iPhone and iPad (`TARGETED_DEVICE_FAMILY = 1,2`,
  iOS 15+) and Android phones and tablets (minSdk 24). On tablets the app
  renders as a centred phone-width column (verified by
  `e2e/layout-viewports.spec.ts`). **Recommendation for the first release:
  iPhone-only** (see the iPad note below); the Xcode change has not been made
  yet and needs founder approval.
- Public website: `https://tastekin.app`. The legal, support and deletion
  pages are served by the deployed app, so they are expected at that host;
  confirm each path resolves there before submission. **Verification status
  (2026-10-10): not verifiable from the agent/CI environment** — outbound
  requests to `tastekin.app` and to the documented Replit host are blocked
  by that environment's network policy, so none of the five URLs has been
  checked. Open each one in Safari on the iPhone before filling the store
  forms. The API base URL the shell talks to (`TASTEKIN_API_BASE_URL`) is a
  separate, still unconfirmed value and must not be assumed to be
  `https://tastekin.app`; the only API hostname documented in the repository
  is `cheerful-easygoing-bytes.replit.app` (`TASTEKIN_CLAUDE.md`), also
  unverified from here.
- Company name and support mailbox: `TASTEKIN, Inc.` is used below only on
  the condition that this exact spelling matches the incorporation
  documents, and `support@tastekin.app` only on the condition that the
  mailbox is confirmed to receive mail. Neither is confirmed yet; neither has
  been written into `src/legal.ts`.

## App Store Connect (English)

| Field | Limit | Draft |
| --- | --- | --- |
| Name | 30 | `TASTEKIN` |
| Subtitle | 30 | `Discover through taste` |
| Promotional text | 170 | `Free, no ads. Find creators, places and routines that match your taste, and ask KIN for looks from your own wardrobe.` |
| Keywords | 100 | `taste,creators,style,outfits,travel,places,restaurants,routine,edits,collections,KIN,arabic` |
| Primary category | — | Lifestyle |
| Secondary category | — | Social Networking |
| Support URL | — | `https://tastekin.app/support` (confirm the path resolves) |
| Marketing URL | — | `https://tastekin.app` |
| Privacy Policy URL | — | `https://tastekin.app/privacy` (confirm the path resolves) |
| Copyright | — | `© 2026 TASTEKIN, Inc.` — only if that exact spelling matches the incorporation documents |

Description (4000 max):

```
TASTEKIN helps you discover creators, places, products and routines through compatible taste rather than popularity.

Taste Match
Tell TASTEKIN what you care about, from fashion and travel to restaurants, daily routines, decor and books. Every creator and Edit you see is scored against your taste, and you can see why it matched.

Edits and collections
Creators publish Edits: photos and videos with captions, place details, ratings, reviews, outfit details and links, organised into collections. Save what you like into your own lists, follow creators, and keep the people you trust in your Circle.

Taste Seal
Verified creators carry a Taste Seal that TASTEKIN reviews and grants. Private messages are available with verified creators.

KIN
KIN Looks suggests outfits from the clothes you already own: add pieces to My Things and ask for a look for the day ahead. KIN Travel turns a destination, dates and interests into an ordered itinerary with real places and driving times.

Built for Arabic and English
Switch languages at any time; the whole app, including right-to-left layout, follows you.

Free and respectful
No subscriptions, no in-app purchases, no ads, and your data is never sold. Report, block and mute controls are built in, and you can delete your account from Settings at any time.
```

What's New (first release): `First release of TASTEKIN.`

### App Store Connect (Arabic, draft for review)

| Field | Draft |
| --- | --- |
| Subtitle | `اكتشف عبر ذوقك` |
| Promotional text | `مجاني وبلا إعلانات. اعثر على مبدعين وأماكن وروتينات تطابق ذوقك، واطلب من KIN إطلالات من خزانتك.` |
| Keywords | `ذوق,مبدعين,أزياء,إطلالات,سفر,أماكن,مطاعم,روتين,مجموعات,KIN,تيستكن` |
| What's New | `الإصدار الأول من TASTEKIN.` |

```
يساعدك TASTEKIN على اكتشاف المبدعين والأماكن والمنتجات والروتينات عبر الذوق المتوافق، لا عبر الشهرة.

تطابق الذوق
أخبر TASTEKIN بما يهمك، من الأزياء والسفر إلى المطاعم والروتين اليومي والديكور والكتب. يُقيَّم كل مبدع وكل Edit تراه مقابل ذوقك، مع توضيح سبب التطابق.

Edits والمجموعات
ينشر المبدعون Edits: صور وفيديوهات مع تعليقات وتفاصيل الأماكن والتقييمات والمراجعات وتفاصيل الإطلالات والروابط، منظمة في مجموعات. احفظ ما يعجبك في قوائمك، وتابع المبدعين، واحتفظ بمن تثق بهم في دائرتك.

ختم الذوق
يحمل المبدعون الموثقون ختم ذوق يراجعه TASTEKIN ويمنحه. الرسائل الخاصة متاحة مع المبدعين الموثقين.

KIN
يقترح KIN Looks إطلالات من الملابس التي تملكها: أضف قطعك إلى أشيائي واطلب إطلالة ليومك. ويحوّل KIN Travel الوجهة والتواريخ والاهتمامات إلى خطة رحلة مرتبة بأماكن حقيقية وأوقات قيادة.

مصمم للعربية والإنجليزية
بدّل اللغة في أي وقت؛ يتبعك التطبيق كله بما في ذلك الاتجاه من اليمين إلى اليسار.

مجاني ويحترم خصوصيتك
لا اشتراكات ولا مشتريات داخل التطبيق ولا إعلانات، ولا تُباع بياناتك أبداً. أدوات الإبلاغ والحظر والكتم مدمجة، ويمكنك حذف حسابك من الإعدادات في أي وقت.
```

### App Privacy answers (match `ios/App/App/PrivacyInfo.xcprivacy`)

Data collected, all linked to the user, none used for tracking: Email
Address, Name, User ID, Photos or Videos, Emails or Text Messages, Other
User Content (app functionality); Product Interaction (analytics).
Tracking: No. Privacy Policy URL as above.

### Age rating questionnaire

Answer from the product: user-generated content with reporting, blocking and
muting; no gambling, contests, violence, medical or sexual content produced by
the app; unrestricted web access: No (links open in the system browser).
Terms require users to be 13 or older. Record the rating the questionnaire
returns; do not pre-state it.

### App Review notes (draft)

```
TASTEKIN is a free taste-based discovery app. Sign in with the demo account below (email/password). Google and Replit sign-in are web-only and intentionally hidden in the app. KIN Looks and KIN Travel call an AI provider; the demo account has quota. Account deletion: Settings → Delete account (two-step confirmation). Reporting, muting and blocking: open another creator's profile and tap the vertical "More options" (⋮) button next to the profile actions; the menu offers "Report this profile", "Mute this user" and "Block this user". On an Edit you do not own, the same ⋮ button offers "Report this Edit"; on a comment, "Report this comment".
```
These in-app paths are taken from the code (`ReportMenu` in `src/App.tsx`)
and are covered by `e2e/creator-actions-navigation.spec.ts` (profile menu in
English and Arabic) — they are the only reporting/blocking surfaces in the
app. Demo account credentials must be created on Production before
submission and pasted here; none exist in the repository.

## Google Play Console

| Field | Limit | Draft |
| --- | --- | --- |
| App name | 30 | `TASTEKIN` |
| Short description | 80 | `Discover creators, places and routines through compatible taste. Free, no ads.` |
| Full description | 4000 | same text as the App Store description above |
| Category | — | Lifestyle |
| Tags | — | Lifestyle, Social |
| Contact email | — | `support@tastekin.app` — only once confirmed to receive mail |
| Contact website | — | `https://tastekin.app` |
| Privacy policy URL | — | `https://tastekin.app/privacy` (confirm the path resolves) |
| Account deletion URL (Data safety) | — | `https://tastekin.app/delete-account` (confirm the path resolves) |
| Developer name shown publicly | — | `TASTEKIN, Inc.` — only if that exact spelling matches the incorporation documents |

Google Play Arabic listing (store listing → add language → Arabic):

| Field | Draft |
| --- | --- |
| Short description (80) | `اكتشف مبدعين وأماكن وروتينات تطابق ذوقك. مجاني وبلا إعلانات.` |
| Full description | same text as the App Store Arabic description above |

Data safety form (from the Privacy Policy and privacy manifest): collects
email, name, user ID, photos and videos, messages, other user-generated
content, app interactions; all encrypted in transit; users can request
deletion (in-app and via the URL above); no data shared with third parties
for advertising; processors listed in the Privacy Policy (Replit, Google,
Anthropic, Bunny Stream for video, Backblaze for storage) act on
TASTEKIN's behalf.

Content rating (IARC): user-generated content with moderation tools; no
other flagged content. Target audience: 13+ per Terms; do not select any
age group under 13.

## Screenshot checklist

Capture from a real build against Production with seeded, rights-cleared
content (the founder's own creator profile and Edits). Never use
third-party photos, other people's faces, or the development database.
Hide personal data: use the demo account, no real email addresses on
screen. Capture in English and Arabic (the stores accept per-locale sets).

Screens, in order:

1. Home "For you" feed with Taste Match scores visible.
2. Explore with category chips and a creator carrying the Taste Seal.
3. An Edit detail with place details and rating.
4. A creator profile with Featured collections.
5. KIN Looks result with a My Things piece.
6. KIN Travel itinerary.
7. Saved lists.
8. Settings in Arabic (right-to-left) to show bilingual support.

Sizes (confirm in each console before uploading):

| Store | Asset | Size |
| --- | --- | --- |
| App Store | iPhone 6.9" (required) | 1320 × 2868 portrait |
| App Store | iPhone 6.5" (optional, scaled from 6.9" if omitted) | 1284 × 2778 |
| App Store | iPad 13" | not needed if the first release is iPhone-only (recommended); 2064 × 2752 if iPad stays targeted |
| App Store | App icon | from the asset catalog (1024 × 1024, already generated) |
| Play | Phone screenshots, 2–8 | 9:16, e.g. 1080 × 1920 (min 320 px, max 3840 px) |
| Play | 7" and 10" tablet screenshots (while tablets are not excluded) | 16:10 or 9:16, e.g. 1200 × 1920 / 1600 × 2560 |
| Play | Feature graphic (required) | 1024 × 500 |
| Play | App icon | 512 × 512 PNG (derive from the approved master, see `native/generate-assets.py`) |

iPad note: the app renders as a centred phone-width column on iPad, and
Apple reviews iPad-targeted apps on iPad. **Decision (2026-10-10): iPhone-only
for the first release, approved by the founder.** The change is exactly two
lines in `ios/App/App.xcodeproj/project.pbxproj`, one per build
configuration: `TARGETED_DEVICE_FAMILY = "1,2";` becomes
`TARGETED_DEVICE_FAMILY = "1";`. `Info.plist` keeps its
`UISupportedInterfaceOrientations~ipad` block (ignored on an iPhone-only
target; harmless). iPad can be added in a later release by setting the value
back to `"1,2"`. Android tablets are unaffected.

## Needed from the founder (not in the repository)

1. Confirmation that `TASTEKIN, Inc.` is the exact spelling on the
   incorporation documents, plus the registered address and governing
   jurisdiction for the Privacy Policy and Terms (`src/legal.ts`
   intentionally omits them; nothing has been added).
2. Confirmation that `support@tastekin.app` receives mail (send a test
   message to it). Until then the `SUPPORT_EMAIL` deployment setting stays
   unset and the app shows "support not configured".
3. The API base URL for the native shell (`TASTEKIN_API_BASE_URL`). The
   public website is `https://tastekin.app`; whether the API is served from
   the same host is not assumed. Also confirm that `/privacy`, `/terms`,
   `/support` and `/delete-account` resolve on `https://tastekin.app`.
4. Apple Developer Program enrolment (individual or organisation; an
   organisation needs a D-U-N-S number) and Google Play developer account,
   including the Play Console contact phone number and the developer name
   shown publicly.
5. iPhone-only is approved; the two-line Xcode change is applied once the
   founder has seen the exact diff. Still open: a decision on the effective
   date of the corrected Terms in PR #101 (left unchanged at 2026-09-23).
6. Demo reviewer account on Production and whether KIN quota should be
   reserved for it.
7. Countries/regions for availability and the public developer name.
8. Sign-off on the English and Arabic listing drafts above.
