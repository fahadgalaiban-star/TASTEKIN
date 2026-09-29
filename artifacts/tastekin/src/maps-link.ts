// Opening a saved place in the device's maps app.
//
// A post stores a human location (placeName / locationLabel / location) and,
// optionally, a maps link the creator pasted. Coordinates are taken from
// that link when it carries any (Google "@lat,lng", "!3dlat!4dlng", or
// q=/query=/ll=/daddr= pairs; Apple "ll="), otherwise the place is looked
// up by name. Each platform gets the link its own maps app understands:
//   iOS      https://maps.apple.com/?ll=…&q=…  (Apple Maps)
//   Android  geo:lat,lng?q=…                   (system maps chooser)
//   web      https://www.google.com/maps/search/?api=1&query=…
// Pure functions, no DOM — covered directly by e2e/post-detail.spec.ts.

export type MapsPlatform = 'ios' | 'android' | 'web';
export type Coordinates = { lat: number; lng: number };

const COORDINATE_PATTERNS: RegExp[] = [
  /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
  /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
  /[?&](?:q|query|ll|sll|daddr|destination|center)=(-?\d{1,3}(?:\.\d+)?)(?:,|%2C)(-?\d{1,3}(?:\.\d+)?)(?:[&),]|$)/i,
];

export function parseCoordinates(url?: string | null): Coordinates | null {
  if (!url) return null;
  for (const pattern of COORDINATE_PATTERNS) {
    const match = pattern.exec(url);
    if (!match) continue;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

const formatCoordinates = ({ lat, lng }: Coordinates) => `${lat},${lng}`;

/** The href that opens `place` in the maps app of `platform`: coordinates when known, the name otherwise. */
export function mapsHref(place: { name: string; coordinates: Coordinates | null }, platform: MapsPlatform): string {
  const name = place.name.trim();
  const coordinates = place.coordinates;
  if (platform === 'ios') {
    if (coordinates) return `https://maps.apple.com/?ll=${formatCoordinates(coordinates)}&q=${encodeURIComponent(name || formatCoordinates(coordinates))}`;
    return `https://maps.apple.com/?q=${encodeURIComponent(name)}`;
  }
  if (platform === 'android') {
    if (coordinates) return `geo:${formatCoordinates(coordinates)}?q=${formatCoordinates(coordinates)}${name ? `(${encodeURIComponent(name)})` : ''}`;
    return `geo:0,0?q=${encodeURIComponent(name)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates ? formatCoordinates(coordinates) : name)}`;
}
