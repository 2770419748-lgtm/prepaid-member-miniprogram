export interface Point {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS = 6371000;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** 两点直线距离，单位米。门店坐标和 wx.getLocation 都用 gcj02，可以直接算。 */
export function distanceMeters(a: Point, b: Point): number {
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 「850m」「1.2km」「36km」。 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.max(1, Math.round(meters))}m`;
  }
  const km = meters / 1000;
  return km < 100 ? `${km.toFixed(1)}km` : `${Math.round(km)}km`;
}
