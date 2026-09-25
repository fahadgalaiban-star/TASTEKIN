# KIN Travel referrals: car rental and restaurant reservations

TASTEKIN is a **referral intermediary only**. Both features hand the member
to an external partner's own website in a new tab. Booking, payment,
insurance, changes, cancellations and customer support stay entirely with
that partner; TASTEKIN never stores, confirms or tracks a booking, and never
takes a payment.

## Feature flags (both OFF by default)

| Flag | What it enables |
| --- | --- |
| `kin_travel_car_rental` | A burgundy "Need a car in …?" card with a "View rental cars" button, shown only after KIN has generated the plan, directly below the trip summary and before Day 1 (never in the trip setup steps). It opens the partner pre-filled with the destination and, when the member entered them, the travel dates. |
| `kin_travel_restaurant_reservations` | A small burgundy "Reserve a table" pill beside the existing Directions / Save to trip actions of **sit-down restaurant and café** stops only, plus a one-line note under them. Derived from Google's own place types: museums, attractions, parks, shops, gyms, bakeries, takeaway-only and meal-delivery businesses, food courts and every other place never get one. With the flag off, only the pill and note disappear; the stop card is unchanged. |

The flags are independent and are toggled from Settings → Admin → Feature
flags like every other flag. While a flag is OFF the API never emits the
corresponding field (`plan.referrals.carRental` / `place.reservation`) and
the web app additionally hides everything related to that feature, so
nothing referral-related can appear to members.

## Partner configuration (required in addition to the flag)

Deployment environment variables — no partner is hard-coded:

| Variable | Purpose | Placeholders |
| --- | --- | --- |
| `KIN_CAR_RENTAL_REFERRAL_URL` | https URL template for the car-rental partner | `{destination}`, `{startDate}`, `{endDate}` (ISO `YYYY-MM-DD`, empty when no dates were entered) |
| `KIN_CAR_RENTAL_PARTNER_NAME` | optional partner name shown in the button ("Rent a car with …") | – |
| `KIN_RESTAURANT_RESERVATION_URL` | https URL template for the reservation partner | `{name}`, `{address}`, `{placeId}`, `{lat}`, `{lng}` |
| `KIN_RESTAURANT_RESERVATION_PARTNER_NAME` | optional partner name shown in the disclaimer | – |

Example: `https://partner.example/cars?city={destination}&pickup={startDate}&dropoff={endDate}`.
Values are URL-encoded when substituted. A template that does not render to
an absolute **https** URL is ignored (nothing is emitted). Never put an API
key or secret in a template — it would be sent to every member's browser.

With a flag ON but no valid template configured, the feature stays invisible.

## Where the code lives

- `artifacts/api-server/src/lib/kin-referrals.ts` — venue classification and
  template rendering; `routes/kin.ts` decorates `POST /api/kin/travel/plan`
  and `POST /api/kin/travel/swap-place` responses only when the flag is on.
- `artifacts/tastekin/src/App.tsx` (KIN Travel overview) — the car-rental
  card directly below the trip summary hero and the per-stop reservation
  pill, each gated on the flag from `/api/me` and rendered only for https
  URLs with `target="_blank" rel="noopener noreferrer sponsored"`. EN + AR
  copy inline.
- Tests: `scripts/src/verify-kin-search.ts` (server: defaults, flag on/off,
  partner configured/unconfigured, encoding, restaurant/café-only including
  takeaway/delivery/food-court exclusion, swap, non-https refusal) and
  `artifacts/tastekin/e2e/kin-referrals.spec.ts` (client: flags
  on/off/independent, placement, unchanged stop cards, unconfigured,
  non-restaurant payload, non-https, Arabic/RTL).

## Not affected

The Capacitor iOS/Android shells ship the same web bundle; with both flags
OFF (the default) their behaviour is unchanged. No store product, payment
SDK or native code is involved.
