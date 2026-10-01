import assert from "node:assert/strict";

const search = { checkIn: "2027-11-01", checkOut: "2027-11-03", adults: 2, rooms: 1 };
const place = { placeId: "google-hotel-1", name: "Hotel One", formattedAddress: "1 Street", lat: 48, lng: 2 };
const candidate = {
  provider: "booking.com", propertyId: "booking-1", propertyName: "Hotel One",
  ...search, totalPrice: 420.50, currency: "USD", taxesAndFeesIncluded: true, availability: "available",
  bookingUrl: "https://booking.example/rooms", checkedAt: "2026-09-25T12:00:00.000Z",
  propertyMatch: { status: "verified", googlePlaceId: place.placeId, partnerPropertyId: "booking-1", evidence: "authoritative_id" },
};
const provider = { provider: "booking.com" as const, findOffers: async () => [candidate] };
let called = 0;
const shouldNotCall = { provider: "booking.com" as const, findOffers: async () => { called += 1; return [candidate]; } };
const stay = { kind: "hotel" as const, ...place, rating: 4.5, priceLevel: null, websiteUrl: null, mapsUrl: null, photoUrl: null, photoAttribution: null, reason: null };
const plan = { destination: "Paris", narrative: "", citations: [], days: [], stays: { hotels: { items: [stay], hasMore: false }, apartments: { items: [{ ...stay, kind: "apartment" as const }], hasMore: false } } };

async function main() {
  // Runtime import keeps the scripts workspace's rootDir independent from api-server.
  const { getHotelOffers, verifiedHotelOffer, withHotelOffersForGroup, withHotelOffersForPlan } =
    await import(new URL("../../artifacts/api-server/src/lib/kin-hotel-offers.ts", import.meta.url).href);
  assert.strictEqual(await withHotelOffersForPlan(plan, search, false), plan, "OFF must return the identical API object");
  assert.strictEqual(await withHotelOffersForGroup(plan.stays!.hotels!, search, false), plan.stays!.hotels, "OFF preserves the hotel response");
  assert.deepEqual(await getHotelOffers(place, search), [], "production registry has no providers");
  assert.deepEqual(await getHotelOffers(place, { ...search, checkOut: search.checkIn }, [shouldNotCall]), [], "invalid dates do not call a provider");
  assert.equal(called, 0);
  assert.deepEqual(await getHotelOffers(place, search, [provider]), [{ ...candidate, roomName: null, cancellationSummary: null }]);
  for (const invalid of [
    { propertyMatch: { ...candidate.propertyMatch, status: "unverified" } },
    { propertyMatch: { ...candidate.propertyMatch, googlePlaceId: "another-hotel" } },
    { propertyMatch: { ...candidate.propertyMatch, evidence: "name_only" } },
    { propertyMatch: { ...candidate.propertyMatch, partnerPropertyId: "another-listing" } },
    { bookingUrl: "http://booking.example/rooms" },
    { bookingUrl: "javascript:alert(1)" },
    { bookingUrl: "not-a-url" },
    { totalPrice: 0 },
    { checkIn: "2027-11-02" },
    { availability: "unavailable" },
  ]) {
    assert.equal(verifiedHotelOffer({ ...candidate, ...invalid }, place.placeId, search, "booking.com"), null, JSON.stringify(invalid));
  }
  const unverifiedProvider = { provider: "booking.com" as const, findOffers: async () => [{ ...candidate, propertyMatch: { ...candidate.propertyMatch, evidence: "name_only" } }] };
  assert.deepEqual(await getHotelOffers(place, search, [unverifiedProvider]), [], "name-only match is never returned");
  assert.equal("hotelOffers" in plan.stays.apartments.items[0], false, "apartments are not enriched");
  process.stdout.write("KIN hotel offer foundation checks passed\n");
}

main().catch((error) => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });