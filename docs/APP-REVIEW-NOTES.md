# App Review notes — template

What to put in App Store Connect → App Review Information for a TASTEKIN
submission, and the facts behind it. **No credentials belong in this
file or anywhere in the repository**: the demo account's email and password
are typed into App Store Connect only. Fields written as `<…>` are filled
in there by the founder at submission time.

## 1. Sign-in information (App Store Connect fields)

| Field | Value |
| --- | --- |
| Sign-in required | Yes |
| User name | `<demo account email — entered in App Store Connect only>` |
| Password | `<demo account password — entered in App Store Connect only>` |

Requirements for the demo account, created on Production before submission:

- Email/password account (the only sign-in method inside the app).
- Granted the Taste Seal (verified creator) by an administrator, with a few
  published Edits (photo and, if video is enabled, one video) and one
  collection, so the reviewer can see creator features, messaging and
  Circle. Verification is granted through the admin review screen; it is
  never self-service.
- Onboarding completed, so the reviewer lands on Home.
- Not an administrator (the admin screens are not part of the review).
- KIN quota reserved for it if KIN Looks / KIN Travel are enabled for the
  review build.

## 2. Contact information

| Field | Value |
| --- | --- |
| First name / Last name | `<founder>` |
| Phone number | `<reachable during review, with country code>` |
| Email | `<monitored mailbox>` — if `support@tastekin.app` is used here, confirm first that it receives mail |

## 3. Notes (paste into the "Notes" field)

Edit the bracketed parts before pasting. Keep it factual; reviewers follow
these steps literally.

```
TASTEKIN is a free taste-based discovery app (no purchases, no ads). Please sign in with the demo account above (email and password). Google sign-in exists on the website only and is intentionally not shown in the app; Replit sign-in is an operator login that regular members never see.

Creating an account: the sign-up form requires ticking "I agree to the Terms of Use and the Privacy Policy"; both documents open inside the form. Terms: https://tastekin.app/terms — Privacy: https://tastekin.app/privacy.

User-generated content and moderation: every Edit, comment and profile can be reported. Open another creator's profile and tap the vertical "More options" (⋮) button next to Follow: the menu offers "Report this profile", "Mute this user" and "Block this user". On an Edit you do not own the same ⋮ button offers "Report this Edit"; on a comment, "Report this comment". Reports are reviewed by TASTEKIN administrators, who can hide content and suspend accounts.

Account deletion: Settings → Delete account (two-step confirmation, type DELETE). Also available at https://tastekin.app/delete-account.

Features enabled for this build: [list the feature flags enabled on Production for review, e.g. KIN Looks, My Things, My Circle — or state that the KIN screen offers Travel only].

KIN: KIN Travel builds an itinerary from a destination, dates and interests using Google Places; KIN Looks suggests outfits from the user's own clothing photos (My Things). Both call an AI provider; the demo account has quota.

Video: Edits can include a video; playback streams from Bunny Stream and needs a network connection.

Links in Edits open in an in-app Safari view; Maps links open the Maps app.

Permissions requested only when used: Camera and Photo Library (to add photos to Edits, the profile and My Things). No location, contacts, microphone or notifications permission is requested.

Not in this version: password reset by email (the Forgot password screen says so and points to support), push notifications. Nothing in the app is region-locked.

Support: https://tastekin.app/support
```

## 4. Facts the notes rely on (keep in sync when the product changes)

| Topic | Fact | Where |
| --- | --- | --- |
| Sign-in inside the app | email/password only; the web-only Google/Replit buttons are hidden by `isNativeApp` | `src/App.tsx` (AuthScreen) |
| Terms consent | required checkbox at sign-up (EN/AR); sent as `termsAccepted` + `termsVersion`; stored on `users.terms_accepted_at` / `terms_version` | `src/App.tsx`, `api-server/src/lib/auth.ts`, migration 0024 |
| Report / block / mute | `ReportMenu` on profiles, Edits and comments; covered by `e2e/creator-actions-navigation.spec.ts` | `src/App.tsx` |
| Admin moderation | reports queue, hide content, suspend accounts, verification review | `docs/admin-moderation-review.md` |
| Account deletion | Settings → Delete account, two-step, `DELETE` confirmation; public `/delete-account` page | `docs/ACCOUNT-DELETION.md` |
| Legal pages | `/privacy`, `/terms`, `/support` served by the app, effective date `LEGAL_EFFECTIVE_DATE` | `src/legal.ts` |
| Permissions | `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`; nothing else | `ios/App/App/Info.plist` |
| Privacy manifest | no tracking, no tracking domains, no required-reason APIs; seven collected data types | `ios/App/App/PrivacyInfo.xcprivacy`, `docs/app-store-listing.md` §3 |
| External links | in-app Safari view (`@capacitor/browser`); Apple/Google Maps links open Maps | `src/lib/external-links.ts` |
| Password reset | the server answers `503 password_reset_unavailable`; the app shows an honest notice | `scripts/src/verify-app-readiness.ts` |
| Export compliance | `ITSAppUsesNonExemptEncryption = false` | `ios/App/App/Info.plist` |
| Version | `1.0.0`, iPhone only, portrait only, iOS 15+ | `project.pbxproj`, `Info.plist` |

## 5. Feature flags and the review build

Flags live in the `feature_flags` table and are changed by an administrator
in the app (Settings → Feature flags, admin accounts only) or left at their
code defaults. The reviewer sees exactly what Production has enabled, so
decide this before submitting and reflect it in the notes above and in the
listing description.

| Flag | Default | What the reviewer sees when enabled |
| --- | --- | --- |
| `google_sign_in` | on | nothing in the app (web only); harmless |
| `replit_sign_in` | off | nothing in the app; on the website it shows "Continue with Replit" (operator/dev sign-in). Keep **off** for members; `/api/login` still works by direct URL |
| `notification_preferences` | off | push/email switches in Settings — keep **off** until delivery exists |
| `my_things` | off | My Things screen under You |
| `closet_item_analysis` | off | automatic tagging suggestions in My Things |
| `kin_search` | off | KIN natural-language entry point (Looks / Travel requests) |
| `kin_looks` | off | Style (KIN Looks) tab in the KIN screen |
| `my_circle` | off | My Circle on Home and the Circle button on verified profiles |
| `owner_follower_count` | off | a Followers tile on the owner-only Insights screen; never on profiles or in any public payload |
| `taste_ranking` | off | Home "For you" ordered by the viewer's taste (never by counts), "Matches your taste" line on cards, taste-tag picker on Edit profile. Off: newest-first |
| `video_upload` | off | kill switch for the video foundation; see its description before touching it |
| `kin_travel_car_rental` | off | "Rent a car" referral link in a travel plan (external partner) |
| `kin_travel_restaurant_reservations` | off | "Reserve a table" referral link on restaurant stops |

The listing description names KIN Looks, My Things and My Circle. Either
enable `kin_looks`, `my_things` (and, if wanted, `closet_item_analysis`,
`kin_search`) and `my_circle` on Production for the review period, or trim
those paragraphs from the description. A description that promises a
feature the reviewer cannot find is a common rejection reason (Guideline
2.3 Accurate Metadata).

## 6. Before submitting — checklist

1. Demo account exists on Production, verified, with content; credentials
   entered in App Store Connect only.
2. Feature flags set as decided above; the notes list them.
3. The four public URLs open in Safari on an iPhone.
4. `SUPPORT_EMAIL` set on the deployment to a mailbox that is read.
5. The TestFlight build under review is the one built from `main` with
   `MARKETING_VERSION = 1.0.0`; install it once from TestFlight and walk
   through sign-up (with the consent box), report, block, mute, delete
   account, and the Arabic switch.
6. Attachments: none required. If a feature needs a physical item or a
   second account to demonstrate (for example messaging between two
   verified creators), say so in the notes and provide a second demo
   account the same way.
