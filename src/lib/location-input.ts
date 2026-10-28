// Parse locations typed or pasted into search: coordinates, map links and plus
// codes. Works offline and on both client and server, so any place a person can
// copy from Google Maps, WhatsApp or OpenStreetMap can be used as a destination.

import type { LngLat } from "./geo";

export type ParsedLocation =
  | { kind: "point"; point: LngLat; source: "coordinates" | "link" | "pluscode" }
  /** A short plus code like "H4P4+XX" that needs a nearby reference to resolve. */
  | { kind: "shortcode"; code: string; locality: string }
  /** A short map link (maps.app.goo.gl) that the server must expand first. */
  | { kind: "shortlink"; url: string };

const NUM = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;

function inIndia(lat: number, lng: number) {
  return lat >= 6 && lat <= 37.5 && lng >= 68 && lng <= 97.5;
}

function valid(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/** "28.6139, 77.2090", "28.6139 77.2090", and DMS such as 28°36'50"N 77°12'32"E. */
export function parseCoordinates(input: string): LngLat | null {
  const s = input.trim();
  const plain = new RegExp(`^(${NUM})\\s*[,;\\s]\\s*(${NUM})$`).exec(s);
  if (plain) {
    let lat = Number(plain[1]);
    let lng = Number(plain[2]);
    // People sometimes paste lng,lat. Swap when only the swapped order lands in India.
    if (Math.abs(lat) > 90 || (!inIndia(lat, lng) && inIndia(lng, lat))) [lat, lng] = [lng, lat];
    return valid(lat, lng) ? [lng, lat] : null;
  }
  const dms = /(\d{1,3})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)["″]?\s*([NS])[\s,]+(\d{1,3})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)["″]?\s*([EW])/i.exec(s);
  if (dms) {
    const deg = (d: string, m: string, sec: string, h: string) => (Number(d) + Number(m) / 60 + Number(sec) / 3600) * (/[SW]/i.test(h) ? -1 : 1);
    const lat = deg(dms[1], dms[2], dms[3], dms[4]);
    const lng = deg(dms[5], dms[6], dms[7], dms[8]);
    return valid(lat, lng) ? [lng, lat] : null;
  }
  return null;
}

/** Coordinates inside Google Maps, Apple Maps, OpenStreetMap or geo: links. */
export function parseMapLink(input: string): LngLat | null {
  let s = input.trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    // keep as is
  }
  const patterns: RegExp[] = [
    // Google's exact place pin comes before the viewport centre.
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /[?&](?:q|query|ll|destination|daddr|center|sll)=(?:loc:)?\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /^geo:(-?\d+\.\d+),(-?\d+\.\d+)/,
    /#map=\d+(?:\.\d+)?\/(-?\d+\.\d+)\/(-?\d+\.\d+)/,
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m && valid(Number(m[1]), Number(m[2]))) return [Number(m[2]), Number(m[1])];
  }
  const mlat = /[?&]mlat=(-?\d+\.\d+)/.exec(s);
  const mlon = /[?&]mlon=(-?\d+\.\d+)/.exec(s);
  if (mlat && mlon && valid(Number(mlat[1]), Number(mlon[1]))) return [Number(mlon[1]), Number(mlat[1])];
  return null;
}

export function isShortMapLink(input: string) {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|maps\.google\.com\/\?cid)/i.test(input.trim());
}

// ---------------------------------------------------------------------------
// Open Location Code ("plus codes"), https://github.com/google/open-location-code
// ---------------------------------------------------------------------------

const ALPHABET = "23456789CFGHJMPQRVWX";
const PAIR_RES = [20, 1, 0.05, 0.0025, 0.000125];
const GRID_COLS = 4;
const GRID_ROWS = 5;

const FULL_CODE = /^[23456789C][23456789CFGHJMPQRV][23456789CFGHJMPQRVWX]{6}\+[23456789CFGHJMPQRVWX]{0,7}$/i;
const SHORT_CODE = /^([23456789CFGHJMPQRVWX]{4}|[23456789CFGHJMPQRVWX]{6})\+[23456789CFGHJMPQRVWX]{2,7}$/i;

export function isFullPlusCode(code: string) {
  return FULL_CODE.test(code);
}

/** Centre of a full plus code. */
export function decodePlusCode(code: string): LngLat {
  const c = code.toUpperCase().replace("+", "").replace(/0+$/, "");
  let lat = -90;
  let lng = -180;
  let latRes = 0;
  let lngRes = 0;
  for (let i = 0; i < Math.min(c.length, 10); i += 2) {
    const res = PAIR_RES[i / 2];
    lat += ALPHABET.indexOf(c[i]) * res;
    lng += ALPHABET.indexOf(c[i + 1] ?? "2") * res;
    latRes = lngRes = res;
  }
  for (let i = 10; i < c.length; i++) {
    latRes /= GRID_ROWS;
    lngRes /= GRID_COLS;
    const d = ALPHABET.indexOf(c[i]);
    lat += Math.floor(d / GRID_COLS) * latRes;
    lng += (d % GRID_COLS) * lngRes;
  }
  return [lng + lngRes / 2, lat + latRes / 2];
}

/** Full 10-digit plus code (about 14 m × 14 m) for a point. */
export function encodePlusCode(lng: number, lat: number): string {
  let latVal = Math.min(Math.max(lat, -90), 90 - 1e-10) + 90;
  let lngVal = ((((lng + 180) % 360) + 360) % 360);
  let code = "";
  for (const res of PAIR_RES) {
    const la = Math.min(19, Math.floor(latVal / res + 1e-9));
    const lo = Math.min(19, Math.floor(lngVal / res + 1e-9));
    latVal -= la * res;
    lngVal -= lo * res;
    code += ALPHABET[la] + ALPHABET[lo];
  }
  return `${code.slice(0, 8)}+${code.slice(8)}`;
}

/** Expand a short code like "H4P4+XX" using the nearest matching cell to `ref` (the spec's recoverNearest). */
export function recoverPlusCode(short: string, ref: LngLat): LngLat {
  const code = short.toUpperCase();
  const padding = 8 - code.indexOf("+");
  const resolution = Math.pow(20, 2 - padding / 2);
  const half = resolution / 2;
  const prefix = encodePlusCode(ref[0], ref[1]).slice(0, padding);
  let [lng, lat] = decodePlusCode(prefix + code);
  if (ref[1] + half < lat && lat - resolution >= -90) lat -= resolution;
  else if (ref[1] - half > lat && lat + resolution <= 90) lat += resolution;
  if (ref[0] + half < lng) lng -= resolution;
  else if (ref[0] - half > lng) lng += resolution;
  return [lng, lat];
}

/** Recognise a location without any network call where possible. */
export function parseLocationInput(input: string): ParsedLocation | null {
  const s = input.trim();
  if (!s) return null;
  const coords = parseCoordinates(s);
  if (coords) return { kind: "point", point: coords, source: "coordinates" };
  if (/^(https?:|geo:)/i.test(s)) {
    const p = parseMapLink(s);
    if (p) return { kind: "point", point: p, source: "link" };
    if (isShortMapLink(s)) return { kind: "shortlink", url: s };
    return null;
  }
  // A plus code, optionally followed by a locality: "7JJQH4P4+XX" or "H4P4+XX Indore, MP".
  const [first, ...rest] = s.split(/[\s,]+/);
  if (isFullPlusCode(first)) return { kind: "point", point: decodePlusCode(first), source: "pluscode" };
  if (SHORT_CODE.test(first)) return { kind: "shortcode", code: first.toUpperCase(), locality: rest.join(" ").trim() };
  return null;
}
