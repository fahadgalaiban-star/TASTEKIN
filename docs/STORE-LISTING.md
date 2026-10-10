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
- Shell targets iPhone and iPad (`TARGETED_DEVICE_FAMILY = 1,2`, iOS 15+) and
  Android phones and tablets (minSdk 24). On tablets the app renders as a
  centred phone-width column; verified by `e2e/layout-viewports.spec.ts`.

## App Store Connect (English)

| Field | Limit | Draft |
| --- | --- | --- |
| Name | 30 | `TASTEKIN` |
| Subtitle | 30 | `Discover through taste` |
| Promotional text | 170 | `Free, no ads. Find creators, places and routines that match your taste, and ask KIN for looks from your own wardrobe.` |
| Keywords | 100 | `taste,creators,style,outfits,travel,places,restaurants,routine,edits,collections,KIN,arabic` |
| Primary category | — | Lifestyle |
| Secondary category | — | Social Networking |
| Support URL | — | `https://<production-host>/support` |
| Marketing URL | — | optional; `https://<production-host>` |
| Privacy Policy URL | — | `https://<production-host>/privacy` |
| Copyright | — | founder decision (see below) |

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
TASTEKIN is a free taste-based discovery app. Sign in with the demo account below (email/password). Google and Replit sign-in are web-only and intentionally hidden in the app. KIN Looks and KIN Travel call an AI provider; the demo account has quota. Account deletion: Settings → Delete account (two-step). Reporting and blocking: the ⋯ menu on any creator profile or Edit.
```
Demo account credentials must be created on Production before submission and
pasted here; none exist in the repository.

## Google Play Console

| Field | Limit | Draft |
| --- | --- | --- |
| App name | 30 | `TASTEKIN` |
| Short description | 80 | `Discover creators, places and routines through compatible taste. Free, no ads.` |
| Full description | 4000 | same text as the App Store description above |
| Category | — | Lifestyle |
| Tags | — | Lifestyle, Social |
| Contact email | — | the configured support address |
| Contact website | — | `https://<production-host>` |
| Privacy policy URL | — | `https://<production-host>/privacy` |
| Account deletion URL (Data safety) | — | `https://<production-host>/delete-account` |

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
| App Store | iPad 13" (required while iPad is targeted) | 2064 × 2752 |
| App Store | App icon | from the asset catalog (1024 × 1024, already generated) |
| Play | Phone screenshots, 2–8 | 9:16, e.g. 1080 × 1920 (min 320 px, max 3840 px) |
| Play | 7" and 10" tablet screenshots (while tablets are not excluded) | 16:10 or 9:16, e.g. 1200 × 1920 / 1600 × 2560 |
| Play | Feature graphic (required) | 1024 × 500 |
| Play | App icon | 512 × 512 PNG (derive from the approved master, see `native/generate-assets.py`) |

iPad note: the app renders as a centred phone-width column on iPad. Either
keep iPad (and take real iPad screenshots that show that framing) or set
`TARGETED_DEVICE_FAMILY` to `1` before the first submission. Changing it
later is allowed but removes the app from iPad users who installed it.

## Needed from the founder (not in the repository)

1. Legal entity name, registered address and governing jurisdiction for the
   Privacy Policy and Terms (`src/legal.ts` intentionally omits them) and the
   copyright line.
2. The final support email address (`SUPPORT_EMAIL`) and whether the legal
   copy's `support@tastekin.app` is that mailbox.
3. The production host for all URLs above (`TASTEKIN_API_BASE_URL`, legal,
   support and deletion URLs).
4. Apple Developer Program enrolment (individual or organisation; an
   organisation needs a D-U-N-S number) and Google Play developer account,
   including the Play Console contact phone number and the developer name
   shown publicly.
5. Decision on iPad support and on the effective date of the corrected Terms
   (PR #101).
6. Demo reviewer account on Production and whether KIN quota should be
   reserved for it.
7. Countries/regions for availability and the public developer name.
8. Sign-off on the English and Arabic listing drafts above.
