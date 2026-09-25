import { useEffect, useState } from 'react';
import { Drawer } from 'vaul';

export type HotelPriceOffer = {
  provider: 'booking.com' | 'expedia';
  propertyId: string;
  propertyName: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  rooms: number;
  roomName: string | null;
  totalPrice: number;
  currency: string;
  taxesAndFeesIncluded: boolean | 'unknown';
  cancellationSummary: string | null;
  availability: 'available';
  bookingUrl: string;
  checkedAt: string;
  propertyMatch: { status: 'verified'; googlePlaceId: string; partnerPropertyId: string; evidence: 'authoritative_id' | 'reviewed_mapping' };
};

export type HotelOfferStay = { placeId: string; name: string; hotelOffers?: HotelPriceOffer[] };
export type HotelOfferContext = {
  destination: string;
  accommodation: { hotels?: { stars?: 3 | 4 | 5; budget?: 1 | 2 | 3 }; apartments?: { stayType?: string; budget?: 1 | 2 | 3 } };
  locale: 'en' | 'ar';
};

/** Browser-side second gate; the server performs the authoritative property and rate validation. */
export function safeHotelOffers(stay: HotelOfferStay): HotelPriceOffer[] {
  return (stay.hotelOffers ?? []).filter((offer) => {
    if (!offer || (offer.provider !== 'booking.com' && offer.provider !== 'expedia')
      || offer.availability !== 'available' || !offer.propertyId || !offer.propertyName
      || offer.propertyMatch?.status !== 'verified' || offer.propertyMatch.googlePlaceId !== stay.placeId
      || offer.propertyMatch.partnerPropertyId !== offer.propertyId
      || (offer.propertyMatch.evidence !== 'authoritative_id' && offer.propertyMatch.evidence !== 'reviewed_mapping')
      || !Number.isFinite(offer.totalPrice) || offer.totalPrice <= 0 || !/^[A-Z]{3}$/.test(offer.currency)
      || !Number.isInteger(offer.adults) || !Number.isInteger(offer.rooms)
      || !Number.isFinite(Date.parse(offer.checkedAt))) return false;
    try {
      const url = new URL(offer.bookingUrl);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  });
}

export function KinHotelOffersSheet({ stay, context, onClose }: {
  stay: HotelOfferStay | null;
  context: HotelOfferContext | null;
  onClose: () => void;
}) {
  const ar = context?.locale === 'ar';
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const [adults, setAdults] = useState(2);
  const [rooms, setRooms] = useState(1);
  const [offers, setOffers] = useState<HotelPriceOffer[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const initial = stay ? safeHotelOffers(stay) : [];
    setOffers(initial);
    setAdults(initial[0]?.adults ?? 2);
    setRooms(initial[0]?.rooms ?? 1);
    setNotice('');
    setLoading(false);
  }, [stay]);

  const refresh = async () => {
    if (!stay || !context) return;
    const initial = safeHotelOffers(stay)[0];
    if (!initial) return;
    setLoading(true);
    setNotice('');
    const requestedAdults = adults;
    const requestedRooms = rooms;
    try {
      const response = await fetch('/api/kin/travel/hotel-offers', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: context.destination, accommodation: context.accommodation, locale: context.locale,
          placeId: stay.placeId, checkIn: initial.checkIn, checkOut: initial.checkOut, adults: requestedAdults, rooms: requestedRooms,
        }),
      });
      if (!response.ok) throw new Error('unavailable');
      const payload = await response.json() as { status: string; offers?: HotelPriceOffer[] };
      if (payload.status !== 'ok' || !Array.isArray(payload.offers)) throw new Error('unavailable');
      const verified = safeHotelOffers({ ...stay, hotelOffers: payload.offers }).filter((offer) =>
        offer.adults === requestedAdults && offer.rooms === requestedRooms && offer.checkIn === initial.checkIn && offer.checkOut === initial.checkOut);
      setOffers(verified);
      if (verified.length === 0) setNotice(t('No verified offers for this selection.', 'لا توجد عروض مؤكدة لهذا الاختيار.'));
    } catch {
      setOffers([]);
      setNotice(t('Prices are unavailable right now.', 'الأسعار غير متاحة حاليًا.'));
    } finally {
      setLoading(false);
    }
  };

  const visible = offers.filter((offer) => offer.adults === adults && offer.rooms === rooms);
  return <Drawer.Root open={stay !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <Drawer.Portal>
      <Drawer.Overlay className="approved-drawer-overlay" />
      <Drawer.Content className="approved-drawer-content kin-stay-sheet" aria-label={t('Compare hotel prices', 'قارن أسعار الفنادق')} data-testid="kin-hotel-offers-sheet">
        <div className="approved-drawer-handle" />
        <h2 className="kin-stay-sheet-title">{t('Compare prices', 'قارن الأسعار')}</h2>
        <div className="kin-stay-sheet-body kin-offer-sheet-body">
          <p className="kin-stay-reason" dir="auto"><bdi>{stay?.name}</bdi></p>
          <div className="kin-offer-occupancy">
            <label>{t('Adults', 'البالغون')}<input type="number" min={1} max={20} value={adults} data-testid="kin-offer-adults" onChange={(event) => setAdults(Math.min(20, Math.max(1, Number(event.target.value) || 1)))} /></label>
            <label>{t('Rooms', 'الغرف')}<input type="number" min={1} max={8} value={rooms} data-testid="kin-offer-rooms" onChange={(event) => setRooms(Math.min(8, Math.max(1, Number(event.target.value) || 1)))} /></label>
          </div>
          {visible.length === 0 && <button type="button" className="approved-button wide" disabled={loading} onClick={() => void refresh()} data-testid="kin-offer-refresh">
            {loading ? t('Checking prices…', 'جارٍ التحقق من الأسعار…') : t('Check prices for these guests', 'تحقق من الأسعار لهؤلاء الضيوف')}
          </button>}
          {notice && <p className="kin-stay-hint" role="status">{notice}</p>}
          {visible.map((offer) => <div className="kin-offer-row" key={`${offer.provider}:${offer.propertyId}:${offer.roomName ?? ''}`} data-testid="kin-offer-row">
            <strong>{offer.provider === 'booking.com' ? 'Booking.com' : 'Expedia'}</strong>
            {offer.roomName && <span dir="auto"><bdi>{offer.roomName}</bdi></span>}
            <bdi className="kin-offer-price" dir="ltr">{new Intl.NumberFormat(ar ? 'ar-KW' : 'en-US', { style: 'currency', currency: offer.currency }).format(offer.totalPrice)}</bdi>
            <span>{offer.taxesAndFeesIncluded === true ? t('Includes taxes and fees', 'يشمل الضرائب والرسوم')
              : offer.taxesAndFeesIncluded === false ? t('Taxes and fees not included', 'لا يشمل الضرائب والرسوم')
                : t('Taxes and fees unknown', 'الضرائب والرسوم غير معروفة')}</span>
            {offer.cancellationSummary && <span dir="auto"><bdi>{offer.cancellationSummary}</bdi></span>}
            <small>{t('Last checked', 'آخر تحقق')}: <bdi dir="ltr">{new Intl.DateTimeFormat(ar ? 'ar-KW' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(offer.checkedAt))}</bdi></small>
            <a className="approved-button primary" href={offer.bookingUrl} target="_blank" rel="noopener noreferrer" data-testid="kin-offer-book">{t(`Continue to ${offer.provider === 'booking.com' ? 'Booking.com' : 'Expedia'}`, `المتابعة إلى ${offer.provider === 'booking.com' ? 'Booking.com' : 'Expedia'}`)}</a>
          </div>)}
          <p className="kin-stay-hint">{t('Prices and availability may change on the partner website. Booking and support are handled by the partner.', 'قد تتغير الأسعار والتوافر على موقع الشريك. يتولى الشريك الحجز والدعم.')}</p>
        </div>
      </Drawer.Content>
    </Drawer.Portal>
  </Drawer.Root>;
}