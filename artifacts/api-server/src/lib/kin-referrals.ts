/**
 * KIN Travel referrals — car rental and restaurant reservations.
 *
 * TASTEKIN is a referral intermediary only: it hands the member to an
 * external partner's own site. Booking, payment, insurance, changes,
 * cancellations and customer support all stay with that partner; nothing
 * here stores, confirms or tracks a booking.
 *
 * Both features are behind their own server feature flag (OFF by default)
 * AND require the operator to configure the partner's URL template. Until
 * both are true for a feature, the API never emits the corresponding field,
 * so a client cannot show anything related to it.
 *
 * Partner URL templates (environment variables):
 *   KIN_CAR_RENTAL_REFERRAL_URL       e.g. https://partner.example/cars?city={destination}&from={startDate}&to={endDate}
 *   KIN_CAR_RENTAL_PARTNER_NAME       optional display name for the button copy
 *   KIN_RESTAURANT_RESERVATION_URL    e.g. https://partner.example/reserve?q={name}&near={address}
 *   KIN_RESTAURANT_RESERVATION_PARTNER_NAME  optional display name
 *
 * Placeholders are replaced with URL-encoded values; a placeholder whose
 * value is unknown (no dates entered, no address) becomes empty. The result
 * must be an absolute https URL, otherwise the referral is omitted rather
 * than emitted broken. No API key or secret ever belongs in a template.
 */

export type KinVenueKind = "restaurant" | "cafe";

export type KinReferralLink = { url: string; partnerName: string | null };

export type KinTravelReferrals = { carRental?: KinReferralLink };

const CAFE_TYPES = new Set(["cafe", "coffee_shop", "tea_house", "cat_cafe", "dog_cafe", "internet_cafe"]);
// Sit-down restaurants only. meal_takeaway, meal_delivery and food_court are
// deliberately NOT here: a takeaway-only counter, a delivery kitchen or a
// food court has no table to reserve.
const RESTAURANT_TYPES = new Set(["restaurant", "diner", "bistro", "steak_house", "pizza_restaurant", "sushi_restaurant"]);

/**
 * Classifies a Google place as somewhere a table can be reserved. Only
 * sit-down restaurants and cafés qualify — museums, attractions, parks,
 * shops, gyms, bakeries, takeaway-only and meal-delivery businesses, food
 * courts and every other place type never do. The primary type wins; the
 * full type list is consulted only when the primary type is not itself a
 * restaurant/café (Google marks many restaurants only via a `*_restaurant`
 * subtype).
 */
export function venueKindFor(primaryType: string | null, types: readonly string[]): KinVenueKind | null {
  const classify = (type: string): KinVenueKind | null => {
    if (CAFE_TYPES.has(type)) return "cafe";
    if (RESTAURANT_TYPES.has(type) || type.endsWith("_restaurant")) return "restaurant";
    return null;
  };
  if (primaryType) {
    const primary = classify(primaryType);
    if (primary) return primary;
  }
  for (const type of types) {
    const kind = classify(type);
    if (kind) return kind;
  }
  return null;
}

function renderTemplate(template: string | undefined, values: Record<string, string | null | undefined>): string | null {
  const trimmed = template?.trim();
  if (!trimmed) return null;
  const rendered = trimmed.replace(/\{([a-zA-Z]+)\}/g, (_match, key: string) => {
    const value = values[key];
    return value === null || value === undefined ? "" : encodeURIComponent(value);
  });
  try {
    const url = new URL(rendered);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function partnerName(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

export type CarRentalRequest = { destination: string; startDate?: string; endDate?: string };

/** The car-rental referral for a plan, or null when no valid partner template is configured. */
export function carRentalReferral(request: CarRentalRequest, env: NodeJS.ProcessEnv = process.env): KinReferralLink | null {
  const url = renderTemplate(env.KIN_CAR_RENTAL_REFERRAL_URL, {
    destination: request.destination,
    startDate: request.startDate ?? null,
    endDate: request.endDate ?? null,
  });
  return url ? { url, partnerName: partnerName(env.KIN_CAR_RENTAL_PARTNER_NAME) } : null;
}

export type ReservablePlace = { placeId: string; name: string; formattedAddress: string | null; lat: number | null; lng: number | null; venueKind: KinVenueKind | null };

/** The table-reservation referral for one place, or null for anything that is not a restaurant/café or when no valid partner template is configured. */
export function restaurantReservationReferral(place: ReservablePlace, env: NodeJS.ProcessEnv = process.env): KinReferralLink | null {
  if (!place.venueKind) return null;
  const url = renderTemplate(env.KIN_RESTAURANT_RESERVATION_URL, {
    name: place.name,
    address: place.formattedAddress,
    placeId: place.placeId,
    lat: place.lat === null ? null : String(place.lat),
    lng: place.lng === null ? null : String(place.lng),
  });
  return url ? { url, partnerName: partnerName(env.KIN_RESTAURANT_RESERVATION_PARTNER_NAME) } : null;
}

export type ReferralFlags = { carRental: boolean; restaurantReservations: boolean };

/** Attaches `reservation` to every restaurant/café place when the flag is on and a partner is configured; leaves every other place untouched. */
export function withReservationReferral<T extends ReservablePlace>(place: T, flags: ReferralFlags, env: NodeJS.ProcessEnv = process.env): T & { reservation?: KinReferralLink } {
  if (!flags.restaurantReservations) return place;
  const reservation = restaurantReservationReferral(place, env);
  return reservation ? { ...place, reservation } : place;
}

/** Plan-level decoration: car-rental referral (destination + dates) and per-place reservation referrals, each strictly behind its own flag. */
export function withTravelReferrals<P extends ReservablePlace, D extends { places: P[] }, Plan extends { destination: string; days: D[] }>(
  plan: Plan,
  request: { startDate?: string; endDate?: string },
  flags: ReferralFlags,
  env: NodeJS.ProcessEnv = process.env,
): Plan & { referrals?: KinTravelReferrals } {
  const days = flags.restaurantReservations
    ? plan.days.map((day) => ({ ...day, places: day.places.map((place) => withReservationReferral(place, flags, env)) }))
    : plan.days;
  const carRental = flags.carRental ? carRentalReferral({ destination: plan.destination, startDate: request.startDate, endDate: request.endDate }, env) : null;
  return { ...plan, days, ...(carRental ? { referrals: { carRental } } : {}) };
}
