/** Physical shop shown on the homepage map and in the footer. */
// Matches the shop's Google Maps business listing (name + address), so the pin and card show.
const QUERY = 'Seçkin Çanta, Hisar Parkı Cd. 12/A, 06250 Altındağ/Ankara'
const q = encodeURIComponent(QUERY)

export const STORE_LOCATION = {
  addressLines: ['Hisar Parkı Cd. No:12/A', 'Ulus, 06250 Altındağ / Ankara'],
  /** Opens the place in Google Maps (app on phones). */
  mapsUrl: `https://www.google.com/maps/search/?api=1&query=${q}`,
  directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
  /** Keyless embed; allowed by frame-src in src/proxy.ts. */
  embedUrl: `https://www.google.com/maps?q=${q}&z=17&output=embed`,
} as const
