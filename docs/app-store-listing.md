# App Store listing — TASTEKIN 1.0.0

Submission-ready text for App Store Connect, in English and Arabic, with the
App Privacy and age-rating answers that match the shipped build. Everything
here is derived from the repository (`src/legal.ts`, the native shell,
`ios/App/App/PrivacyInfo.xcprivacy`, `docs/STORE-LISTING.md`). Items marked
**founder** are decisions or confirmations that are not in the repository
and must be settled before the form is submitted. `docs/STORE-LISTING.md`
keeps the Google Play draft and the screenshot checklist.

Build facts: name `TASTEKIN`, bundle ID `app.tastekin`, version `1.0.0`,
iPhone only, portrait only, iOS 15 or later, free, no in-app purchases, no
ads, no third-party advertising or tracking SDKs.

## 1. App information (English, primary locale `en-US`)

| Field | Limit | Text |
| --- | --- | --- |
| Name | 30 | `TASTEKIN` |
| Subtitle | 30 | `Discover through taste` |
| Primary category | — | Lifestyle |
| Secondary category | — | Social Networking |
| Content rights | — | The app contains only content the user or other TASTEKIN members created; TASTEKIN holds no third-party licensed content. **founder**: confirm. |
| Age rating | — | from the questionnaire in section 5 |
| Copyright | — | `© 2026 TASTEKIN` — **founder**: use the exact legal entity name once confirmed; do not add "Inc." or any suffix that is not on the incorporation documents |
| Support URL | — | `https://tastekin.app/support` — **founder**: open it in Safari once before submitting |
| Marketing URL | — | `https://tastekin.app` |
| Privacy Policy URL | — | `https://tastekin.app/privacy` — **founder**: open it in Safari once before submitting |
| Sign-in required | — | Yes, for creating content, saving, following, messaging and KIN. Browsing public Edits does not require an account. |

### Promotional text (170)

```
Free, no ads. Find creators, places and routines that match your taste, and ask KIN for looks from your own wardrobe.
```

### Description (4000)

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

### Keywords (100, comma-separated, no spaces, no repeats of the name)

```
taste,creators,style,outfits,travel,places,restaurants,routine,edits,collections,KIN,arabic
```

### What's New (first release)

```
First release of TASTEKIN.
```

## 2. App information (Arabic, `ar-SA`)

| Field | Text |
| --- | --- |
| Name | `TASTEKIN` (the name is not translated) |
| Subtitle | `اكتشف عبر ذوقك` |
| Promotional text | `مجاني وبلا إعلانات. اعثر على مبدعين وأماكن وروتينات تطابق ذوقك، واطلب من KIN إطلالات من خزانتك.` |
| Keywords | `ذوق,مبدعين,أزياء,إطلالات,سفر,أماكن,مطاعم,روتين,مجموعات,KIN,تيستكن` |
| What's New | `الإصدار الأول من TASTEKIN.` |
| Support / Marketing / Privacy URLs | same as English; the pages switch to Arabic inside the app with `?lang=ar` |

### الوصف

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

## 3. App Privacy (App Store Connect → App Privacy)

These answers match `ios/App/App/PrivacyInfo.xcprivacy` and the Privacy
Policy in `src/legal.ts`. Answer **"Yes, we collect data from this app"**,
then declare exactly these types. Every type is **linked to the user's
identity** and **not used for tracking**.

| App Store data type | Collected? | Linked to user | Used for tracking | Purpose(s) | Where it comes from |
| --- | --- | --- | --- | --- | --- |
| Contact Info → Email Address | Yes | Yes | No | App Functionality | account sign-up and sign-in |
| Contact Info → Name | Yes | Yes | No | App Functionality | profile display name |
| Identifiers → User ID | Yes | Yes | No | App Functionality, Analytics | account id, used to count product interactions |
| User Content → Photos or Videos | Yes | Yes | No | App Functionality | Edits, profile photo, My Things photos, collection covers |
| User Content → Emails or Text Messages | Yes | Yes | No | App Functionality | private messages with verified creators |
| User Content → Other User Content | Yes | Yes | No | App Functionality | captions, comments, reviews, taste preferences, KIN requests, reports |
| Usage Data → Product Interaction | Yes | Yes | No | Analytics | in-app events (views, saves, follows) kept by TASTEKIN itself |

Not collected: precise or coarse location (KIN Travel uses a destination the
user types; the app has no location permission), contacts, health or
fitness data, financial data, browsing or search history outside the app,
device identifiers for advertising, crash or performance data from a
third-party SDK, purchase history.

Additional questions:

| Question | Answer |
| --- | --- |
| Do you or your third-party partners use data for tracking? | No |
| Privacy choices: can users request deletion? | Yes — Settings → Delete account (two-step), and `https://tastekin.app/delete-account` |
| Data processors named in the Privacy Policy | Replit (hosting), Google (Places/Routes for KIN Travel; Google sign-in on the web only), Anthropic (KIN), Bunny Stream (video), Backblaze (file storage) — all act on TASTEKIN's behalf |
| Privacy manifest | included in the app target; tracking: no; tracking domains: none; required-reason APIs: none |

## 4. Terms of Use (EULA)

Use Apple's standard EULA (leave the custom EULA field empty). The app's
own Terms of Use are shown in the app and at `https://tastekin.app/terms`,
and every email/password sign-up requires ticking "I agree to the Terms of
Use and the Privacy Policy" before the account is created; the acceptance
time and the Terms version are stored with the account.

## 5. Age rating questionnaire (answers from the product)

| Question | Answer | Why |
| --- | --- | --- |
| Cartoon or fantasy violence; realistic violence; prolonged graphic violence | None | the app produces no such content |
| Profanity or crude humor | None | none produced by the app; user content is moderated (report, block, mute, admin review) |
| Mature/suggestive themes; sexual content or nudity | None | as above |
| Horror/fear themes | None | — |
| Medical/treatment information | None | — |
| Alcohol, tobacco or drug use or references | None | restaurant and place reviews do not feature these |
| Simulated gambling; contests | None | — |
| Unrestricted web access | No | creators' links open in an in-app Safari view for that link only; there is no address bar or general browser |
| Gambling | No | — |
| User-generated content | Yes | Edits, comments, messages; reporting, blocking and muting are built in and TASTEKIN reviews reports |
| Made for Kids | No | the Terms require users to be 13 or older |

Record the rating the questionnaire returns; do not pre-state it. In
"App Review Information" use `docs/APP-REVIEW-NOTES.md`.

## 6. Pricing, availability and version

| Field | Value |
| --- | --- |
| Price | Free (Tier 0) |
| In-app purchases | none |
| Availability | **founder**: choose the countries/regions |
| Version | `1.0.0` (from `MARKETING_VERSION`) |
| Build | the TestFlight upload's build number (the workflow's run number unless typed in) |
| Export compliance | `ITSAppUsesNonExemptEncryption = false` is in `Info.plist`; no extra documentation needed |

## 7. Founder checklist before pressing Submit

1. Confirm the legal entity name for Copyright (and, later, for
   `src/legal.ts`); nothing here assumes a suffix.
2. Confirm `support@tastekin.app` receives mail, or set a different
   `SUPPORT_EMAIL` on the deployment; the Support page shows that address.
3. Open `https://tastekin.app/support`, `/privacy`, `/terms` and
   `/delete-account` in Safari on the iPhone; all four must load.
4. Create the App Review demo account on Production and enter it only in
   App Store Connect → App Review Information (see `docs/APP-REVIEW-NOTES.md`).
5. Decide which feature flags are enabled on Production for the review
   build (see the same notes) so the reviewer sees what the description
   promises.
6. Choose the countries/regions and sign off the English and Arabic text
   above.
