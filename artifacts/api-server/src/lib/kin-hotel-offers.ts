import type { GooglePlace } from "./google-places";
import type { KinTravelStay, KinTravelStayGroup, KinTravelPlan } from "./kin-travel";
import { logger } from "./logger";

export type HotelOfferSearch = {
  checkIn: string;
  checkOut: string;
  adults: number;
  rooms: number;
};

export type HotelPropertyIdentity = Pick<GooglePlace, "placeId" | "name" | "formattedAddress" | "lat" | "lng">;

export type HotelPriceOffer = {
  provider: "booking.com" | "expedia";
  propertyId: string;
  propertyName: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  rooms: number;
  roomName: string | null;
  totalPrice: number;
  currency: string;
  taxesAndFeesIncluded: boolean | "unknown";
  cancellationSummary: string | null;
  availability: "available";
  bookingUrl: string;
  checkedAt: string;
  propertyMatch: {
    status: "verified";
    googlePlaceId: string;
    partnerPropertyId: string;
    evidence: "authoritative_id" | "reviewed_mapping";
  };
};

/** Provider adapters must supply an authoritative ID crosswalk or a reviewed mapping, never a name-only guess. */
export type HotelOfferProvider = {
  provider: HotelPriceOffer["provider"];
  findOffers: (googlePlace: HotelPropertyIdentity, search: HotelOfferSearch) => Promise<unknown[]>;
};

// Deliberately empty: official partner approval, credentials, matching and implementation are separate work.
const productionProviders: readonly HotelOfferProvider[] = [];
export function hasHotelOfferProviders(): boolean {
  return productionProviders.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function validHotelOfferSearch(value: unknown): value is HotelOfferSearch {
  if (!isRecord(value)) return false;
  return isDate(value.checkIn) && isDate(value.checkOut) && value.checkOut > value.checkIn
    && Number.isInteger(value.adults) && (value.adults as number) >= 1 && (value.adults as number) <= 20
    && Number.isInteger(value.rooms) && (value.rooms as number) >= 1 && (value.rooms as number) <= 8;
}

/** A provider response is untrusted even after its adapter has found a candidate. */
export function verifiedHotelOffer(value: unknown, googlePlaceId: string, search: HotelOfferSearch, provider: HotelOfferProvider["provider"]): HotelPriceOffer | null {
  if (!isRecord(value) || !isRecord(value.propertyMatch)) return null;
  const match = value.propertyMatch;
  if (value.provider !== provider || !googlePlaceId || match.status !== "verified" || match.googlePlaceId !== googlePlaceId
    || match.partnerPropertyId !== value.propertyId || !["authoritative_id", "reviewed_mapping"].includes(String(match.evidence))) return null;
  if (typeof value.propertyId !== "string" || !value.propertyId.trim()
    || typeof value.propertyName !== "string" || !value.propertyName.trim()
    || value.checkIn !== search.checkIn || value.checkOut !== search.checkOut
    || value.adults !== search.adults || value.rooms !== search.rooms || value.availability !== "available") return null;
  if (typeof value.totalPrice !== "number" || !Number.isFinite(value.totalPrice) || value.totalPrice <= 0
    || typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency)
    || ![true, false, "unknown"].includes(value.taxesAndFeesIncluded as string | boolean)) return null;
  if (value.roomName != null && (typeof value.roomName !== "string" || value.roomName.length > 200)) return null;
  if (value.cancellationSummary != null && (typeof value.cancellationSummary !== "string" || value.cancellationSummary.length > 500)) return null;
  if (typeof value.checkedAt !== "string" || !Number.isFinite(Date.parse(value.checkedAt))
    || new Date(value.checkedAt).toISOString() !== value.checkedAt) return null;
  if (typeof value.bookingUrl !== "string") return null;
  try {
    const url = new URL(value.bookingUrl);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
  } catch {
    return null;
  }
  return { ...value, roomName: value.roomName ?? null, cancellationSummary: value.cancellationSummary ?? null } as HotelPriceOffer;
}

export async function getHotelOffers(
  googlePlace: HotelPropertyIdentity,
  search: HotelOfferSearch,
  providers: readonly HotelOfferProvider[] = productionProviders,
): Promise<HotelPriceOffer[]> {
  if (!validHotelOfferSearch(search) || !googlePlace.placeId || providers.length === 0) return [];
  const results = await Promise.all(providers.map(async (provider) => {
    try {
      const candidates = await provider.findOffers(googlePlace, search);
      return candidates.flatMap((candidate) => {
        const offer = verifiedHotelOffer(candidate, googlePlace.placeId, search, provider.provider);
        return offer ? [offer] : [];
      });
    } catch (error) {
      logger.warn({ provider: provider.provider, type: error instanceof Error ? error.name : "unknown", message: error instanceof Error ? error.message : String(error) }, "KIN hotel offer provider failed");
      return [];
    }
  }));
  return results.flat();
}

/** No additional fields or calls at all when the flag is OFF or there are no providers. */
export async function withHotelOffersForPlan(plan: KinTravelPlan, search: HotelOfferSearch, enabled: boolean): Promise<KinTravelPlan> {
  if (!enabled || !hasHotelOfferProviders() || !plan.stays?.hotels || !validHotelOfferSearch(search)) return plan;
  const hotels = await withHotelOffersForGroup(plan.stays.hotels, search, enabled);
  return { ...plan, stays: { ...plan.stays, hotels } };
}

export async function withHotelOffersForGroup(group: KinTravelStayGroup, search: HotelOfferSearch, enabled: boolean): Promise<KinTravelStayGroup> {
  if (!enabled || !hasHotelOfferProviders() || !validHotelOfferSearch(search)) return group;
  const items = await Promise.all(group.items.map(async (stay): Promise<KinTravelStay> => {
    // Provider matching needs the Google identity and location, never a member-provided partner ID.
    const place: HotelPropertyIdentity = { placeId: stay.placeId, name: stay.name, formattedAddress: stay.formattedAddress, lat: stay.lat, lng: stay.lng };
    const offers = await getHotelOffers(place, search);
    return offers.length ? { ...stay, hotelOffers: offers } : stay;
  }));
  return { ...group, items };
}