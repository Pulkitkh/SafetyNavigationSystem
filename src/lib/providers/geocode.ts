import { haversine, type LngLat } from "@/lib/geo";
import { parseMapLink } from "@/lib/location-input";
import { cached, fetchJson, userAgent } from "./http";
import { olaSearch } from "./ola";

export interface Place {
  label: string;
  detail: string;
  lng: number;
  lat: number;
  /** Human-readable type, e.g. "Metro station", "Hospital", "Neighbourhood". */
  kind?: string;
  /** Metres from the search reference point, when one was given. */
  distance?: number;
  source?: "photon" | "nominatim" | "ola" | "input";
}

// India bounding box (minLon,minLat,maxLon,maxLat). It also covers parts of
// Pakistan, Nepal and Bangladesh, so results are filtered by country code too.
const INDIA_BBOX = "68.1,6.5,97.5,35.7";

interface PhotonFeature {
  geometry: { coordinates: LngLat };
  properties: Record<string, string | undefined>;
}

const KIND_LABELS: Record<string, string> = {
  "railway:station": "Railway station",
  "railway:subway_entrance": "Metro entrance",
  "railway:halt": "Railway halt",
  "station:subway": "Metro station",
  "public_transport:station": "Station",
  "highway:bus_stop": "Bus stop",
  "amenity:bus_station": "Bus stand",
  "aeroway:aerodrome": "Airport",
  "amenity:hospital": "Hospital",
  "amenity:clinic": "Clinic",
  "amenity:pharmacy": "Pharmacy",
  "amenity:police": "Police station",
  "amenity:college": "College",
  "amenity:university": "University",
  "amenity:school": "School",
  "amenity:restaurant": "Restaurant",
  "amenity:cafe": "Café",
  "amenity:fast_food": "Food",
  "amenity:fuel": "Petrol pump",
  "amenity:bank": "Bank",
  "amenity:atm": "ATM",
  "amenity:place_of_worship": "Place of worship",
  "amenity:cinema": "Cinema",
  "amenity:marketplace": "Market",
  "shop:mall": "Mall",
  "shop:supermarket": "Supermarket",
  "tourism:hotel": "Hotel",
  "tourism:attraction": "Attraction",
  "leisure:park": "Park",
  "place:city": "City",
  "place:town": "Town",
  "place:village": "Village",
  "place:suburb": "Area",
  "place:neighbourhood": "Neighbourhood",
  "place:quarter": "Area",
  "place:locality": "Locality",
  "place:hamlet": "Hamlet",
  "building:apartments": "Apartments",
  "building:residential": "Residence",
  "landuse:residential": "Residential area",
};

export function kindLabel(key?: string, value?: string): string | undefined {
  if (!key) return undefined;
  if (KIND_LABELS[`${key}:${value}`]) return KIND_LABELS[`${key}:${value}`];
  if (key === "highway") return value === "bus_stop" ? "Bus stop" : "Road";
  if (key === "shop") return "Shop";
  if (key === "building" || key === "place") return undefined;
  return undefined;
}

function uniqueParts(parts: (string | undefined)[], exclude: string) {
  return parts.filter((x, i, arr): x is string => !!x && arr.indexOf(x) === i && x !== exclude).join(", ");
}

export function photonToPlace(f: PhotonFeature, near?: LngLat): Place | null {
  const p = f.properties;
  if (p.countrycode && p.countrycode !== "IN") return null;
  const label = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || p.city || p.district;
  if (!label) return null;
  const [lng, lat] = f.geometry.coordinates;
  return {
    label,
    detail: uniqueParts([p.street && p.name ? p.street : undefined, p.locality, p.district, p.city, p.state], label),
    lng,
    lat,
    kind: kindLabel(p.osm_key, p.osm_value),
    distance: near ? Math.round(haversine(near, [lng, lat])) : undefined,
    source: "photon",
  };
}

/** Nearer is better, steeply: a 1 km match beats a 50 km one with the same name quality. */
function proximityBonus(m: number) {
  if (m <= 5_000) return 5;
  if (m <= 20_000) return 4;
  if (m <= 60_000) return 2;
  if (m <= 300_000) return 0;
  return -1;
}

/** Edit distance, for spelling variants of place names. */
export function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

function similar(a: string, b: string) {
  if (a.length < 4 || b.length < 4) return false;
  return editDistance(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) * 0.25));
}

function tokens(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Order results by how well the name matches the query, then by being within
 * ~60 km of the person, keeping each service's own order as the tie-break.
 */
export function rankPlaces(places: Place[], query: string, near?: LngLat): Place[] {
  const q = tokens(query);
  const qJoined = q.join("");
  const score = (p: Place) => {
    const name = tokens(p.label);
    const detail = tokens(p.detail);
    let s = 0;
    for (const t of q) {
      if (name.some((n) => n === t)) s += 3;
      else if (name.some((n) => n.startsWith(t) || t.startsWith(n) || similar(n, t))) s += 2;
      else if (detail.some((d) => d === t || d.startsWith(t) || similar(d, t))) s += 1;
    }
    // Indian names are spelt many ways and spaced differently: "Bhawarkua" / "Bhanwar Kuan".
    // (Single-word names were already compared token by token above.)
    const nJoined = name.join("");
    if ((name.length > 1 || q.length > 1) && qJoined.length >= 5 && similar(nJoined, qJoined)) s += Math.max(1, 4 - editDistance(nJoined, qJoined));
    if (near && p.distance != null) s += proximityBonus(p.distance);
    return s;
  };
  return places
    .map((p, i) => ({ p, i, s: score(p) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.p);
}

// Names shared by many separate places; two of these a few hundred metres apart are different places.
const GENERIC_NAME =
  /^(police (station|chowki|post)|thana|bus (stop|stand)|atm|hospital|clinic|pharmacy|medical( store)?|chemist|petrol pump|fuel station|temple|mandir|mosque|masjid|church|gurudwara|school|park|garden|metro station|railway station|post office|bank|toilet|public toilet|parking)$/;

function nameKey(label: string) {
  return label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Same place reported twice (by several services, as node and way, or pinned at
 * different entrances): the same name within 1.2 km, or 300 m for generic names
 * like "Police station" that many separate places share.
 */
export function mergePlaces(lists: Place[][], limit = 10): Place[] {
  const out: Place[] = [];
  for (const list of lists) {
    for (const p of list) {
      const key = nameKey(p.label);
      const radius = GENERIC_NAME.test(key) ? 300 : 1200;
      const dup = out.some((o) => nameKey(o.label) === key && haversine([o.lng, o.lat], [p.lng, p.lat]) < radius);
      if (!dup) out.push(p);
    }
  }
  return out.slice(0, limit);
}

async function photon(query: string, near?: LngLat): Promise<Place[]> {
  const base = process.env.PHOTON_URL || "https://photon.komoot.io";
  const params = new URLSearchParams({ q: query, limit: "15", lang: "en", bbox: INDIA_BBOX });
  if (near) {
    params.set("lon", near[0].toFixed(3));
    params.set("lat", near[1].toFixed(3));
    // Prefer nearby results without hiding famous places elsewhere.
    params.set("location_bias_scale", "0.3");
    params.set("zoom", "12");
  }
  const url = `${base}/api/?${params}`;
  const data = await cached("photon", url, 24 * 3600_000, () =>
    // The public Photon server drops some requests; one quick retry recovers most.
    fetchJson<{ features: PhotonFeature[] }>(url, { service: "search", timeoutMs: 5000, retries: 1 }),
  );
  return data.features.map((f) => photonToPlace(f, near)).filter((p): p is Place => !!p);
}

interface NominatimResult {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  category?: string;
  type?: string;
  address?: Record<string, string>;
}

export function nominatimToPlace(r: NominatimResult, near?: LngLat): Place {
  const a = r.address ?? {};
  const label = r.name || r.display_name.split(",")[0];
  const lng = Number(r.lon);
  const lat = Number(r.lat);
  return {
    label,
    detail: uniqueParts([a.road, a.neighbourhood || a.suburb, a.city || a.town || a.village || a.county, a.state], label),
    lng,
    lat,
    kind: kindLabel(r.category, r.type),
    distance: near ? Math.round(haversine(near, [lng, lat])) : undefined,
    source: "nominatim",
  };
}

// Nominatim's usage policy allows at most one request per second.
let nominatimQueue: Promise<unknown> = Promise.resolve();
let lastNominatim = 0;
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimQueue.then(async () => {
    const wait = lastNominatim + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatim = Date.now();
    return fn();
  });
  nominatimQueue = run.catch(() => undefined);
  return run;
}

/**
 * Full-text search over all of OpenStreetMap, including addresses and small
 * places that Photon's autocomplete index misses. Nominatim's policy forbids
 * autocomplete traffic, so this runs only on an explicit search (Enter or
 * "Search all places"), never per keystroke.
 */
async function nominatim(query: string, near?: LngLat): Promise<Place[]> {
  const base = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
  const params = new URLSearchParams({ q: query, format: "jsonv2", addressdetails: "1", limit: "10", countrycodes: "in", "accept-language": "en" });
  if (near) {
    // Prefer a ~50 km box around the person without excluding results outside it.
    const d = 0.45;
    params.set("viewbox", [near[0] - d, near[1] + d, near[0] + d, near[1] - d].map((v) => v.toFixed(3)).join(","));
  }
  const url = `${base}/search?${params}`;
  const rows = await cached("nominatim-search", url, 7 * 24 * 3600_000, () =>
    throttled(() => fetchJson<NominatimResult[]>(url, { service: "search", timeoutMs: 8000 })),
  );
  return rows.map((r) => nominatimToPlace(r, near));
}

export interface SearchResult {
  places: Place[];
  /** Photon failed; the client should offer a full search. */
  degraded?: boolean;
}

/**
 * Search-as-you-type uses Photon (and Ola Maps when configured); `deep` (an
 * explicit search) also asks Nominatim. Results from all sources are merged and
 * ranked together.
 */
export async function searchPlaces(query: string, near?: LngLat, { deep = false } = {}): Promise<SearchResult> {
  const [photonResult, nominatimResult, olaResult] = await Promise.allSettled([
    photon(query, near),
    deep ? nominatim(query, near) : Promise.resolve([]),
    olaSearch(query, near),
  ]);
  const fromPhoton = photonResult.status === "fulfilled" ? photonResult.value : [];
  const fromNominatim = nominatimResult.status === "fulfilled" ? nominatimResult.value : [];
  const fromOla = olaResult.status === "fulfilled" ? olaResult.value : [];
  if (olaResult.status === "rejected") console.warn(`[search] Ola Maps: ${(olaResult.reason as Error).message}`);
  const anyResults = fromPhoton.length || fromNominatim.length || fromOla.length;
  if (photonResult.status === "rejected" && !anyResults && (!deep || nominatimResult.status === "rejected")) {
    if (!deep) return { places: [], degraded: true };
    throw photonResult.reason;
  }
  const lists = deep ? [fromNominatim, fromOla, fromPhoton] : [fromOla, fromPhoton];
  const places = rankPlaces(mergePlaces(lists, 30), query, near).slice(0, 10);
  return { places, degraded: photonResult.status === "rejected" && !fromOla.length };
}

/** Only Google's own map hosts may be fetched, so a crafted link can't point the server at internal addresses. */
export function isGoogleMapsHost(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /(^|\.)(google\.(com|co\.in|[a-z]{2,3})|goo\.gl|g\.co)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** Follow a short map link (maps.app.goo.gl/…) to the long URL that carries coordinates. */
export async function expandShortLink(url: string): Promise<string> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!isGoogleMapsHost(current)) throw new Error("Not a Google Maps link");
    const res = await fetch(current, { method: "GET", redirect: "manual", headers: { "User-Agent": userAgent() }, signal: AbortSignal.timeout(6000) });
    void res.body?.cancel();
    const next = res.headers.get("location");
    if (!next) return current;
    current = new URL(next, current).toString();
    // The coordinates are in the URL itself; stop as soon as they appear.
    if (parseMapLink(current)) return current;
  }
  return current;
}

export async function reverseGeocode(point: LngLat): Promise<Place> {
  const base = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
  const params = new URLSearchParams({
    lat: point[1].toFixed(5),
    lon: point[0].toFixed(5),
    format: "jsonv2",
    zoom: "18",
    "accept-language": "en",
  });
  const url = `${base}/reverse?${params}`;
  const data = await cached("nominatim-rev", url, 7 * 24 * 3600_000, () =>
    throttled(() =>
      fetchJson<{ display_name?: string; name?: string; address?: Record<string, string> }>(url, {
        service: "reverse geocoding",
        timeoutMs: 8000,
      }),
    ),
  );
  const a = data.address ?? {};
  const label =
    data.name || [a.house_number, a.road].filter(Boolean).join(" ") || a.neighbourhood || a.suburb || data.display_name?.split(",")[0] || "Dropped pin";
  const detail = uniqueParts([a.neighbourhood || a.suburb, a.city || a.town || a.village, a.state], label);
  return { label, detail, lng: point[0], lat: point[1] };
}
