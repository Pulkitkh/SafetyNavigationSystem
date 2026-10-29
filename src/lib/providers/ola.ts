/**
 * Ola Maps place search (optional). Ola's index covers many Indian shops,
 * buildings and addresses that OpenStreetMap lacks. It is used only when
 * OLA_MAPS_API_KEY is set, alongside the OpenStreetMap search services.
 *
 * Get a key at https://maps.olakrutrim.com (Krutrim Cloud → Ola Maps → API keys).
 */
import { randomUUID } from "node:crypto";
import { haversine, type LngLat } from "@/lib/geo";
import type { Place } from "./geocode";
import { cached, fetchJson, UpstreamError } from "./http";

export function olaEnabled() {
  return !!process.env.OLA_MAPS_API_KEY?.trim();
}

// A per-instance daily cap so a busy day can't run past the free quota unnoticed.
const DAILY_LIMIT = () => Number(process.env.OLA_MAPS_DAILY_LIMIT) || 3000;
let day = "";
let used = 0;

/** Counts one request against today's cap; false once the cap is reached. */
export function takeOlaQuota(now = new Date()): boolean {
  const today = now.toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    used = 0;
  }
  if (used >= DAILY_LIMIT()) return false;
  used++;
  return true;
}

export function resetOlaForTests() {
  day = "";
  used = 0;
}

interface OlaPrediction {
  description?: string;
  place_id?: string;
  types?: string[];
  distance_meters?: number;
  structured_formatting?: { main_text?: string; secondary_text?: string };
  geometry?: { location?: { lat?: number; lng?: number } };
  name?: string;
  formatted_address?: string;
}

interface OlaResponse {
  predictions?: OlaPrediction[];
  status?: string;
  error_message?: string;
}

const OLA_KINDS: [RegExp, string][] = [
  [/metro|subway/, "Metro station"],
  [/train_station|railway/, "Railway station"],
  [/bus_station|bus_stop|transit/, "Bus stop"],
  [/airport/, "Airport"],
  [/hospital/, "Hospital"],
  [/pharmacy|drugstore/, "Pharmacy"],
  [/police/, "Police station"],
  [/shopping_mall/, "Mall"],
  [/restaurant|cafe|food/, "Food"],
  [/school|university|college/, "School"],
  [/lodging|hotel/, "Hotel"],
  [/locality|sublocality|neighborhood|neighbourhood/, "Area"],
  [/route|street/, "Road"],
];

function olaKind(types: string[] = []) {
  const t = types.join(" ").toLowerCase();
  return OLA_KINDS.find(([re]) => re.test(t))?.[1];
}

/** Tolerates both autocomplete-style and text-search-style predictions. */
export function olaToPlace(p: OlaPrediction, near?: LngLat): Place | null {
  const lat = Number(p.geometry?.location?.lat);
  const lng = Number(p.geometry?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const label = p.structured_formatting?.main_text || p.name || p.description?.split(",")[0];
  if (!label) return null;
  const full = p.structured_formatting?.secondary_text || p.formatted_address || p.description || "";
  // Ola often repeats the name in short form ("56 Dukan St" after "56 Dukan Street"), repeats localities,
  // and leads with house and unit numbers or a stray "Rd", none of which help pick a place.
  const seen = new Set<string>();
  const detail = full
    .split(",")
    .map((s) => s.replace(/\s+\d{6}$/, "").trim())
    .filter((s) => {
      const key = s.toLowerCase();
      if (!s || seen.has(key) || label.toLowerCase().startsWith(key) || /^india$/i.test(s)) return false;
      if (/^[\d\s/-]+[a-z]?$/i.test(s) || /^(st|rd|ln|road|street|marg)$/i.test(s) || /^(unit|shop|flat|plot|house)\b|^no\.?\s/i.test(s)) return false;
      // Floors inside a building ("Second Floor-Mezzanine & Third Floor") and unit codes ("IBB-2", "F-55").
      if (/\b(floor|flr|mezzanine|basement|level|lower ground|upper ground)\b/i.test(s) || (/\d/.test(s) && !/[a-z]/.test(s))) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3)
    .join(", ");
  return {
    label,
    detail,
    lng,
    lat,
    kind: olaKind(p.types),
    distance: near ? Math.round(haversine(near, [lng, lat])) : undefined,
    source: "ola",
  };
}

/** Autocomplete over Ola's India index. Returns [] when not configured or over the daily cap. */
export async function olaSearch(query: string, near?: LngLat): Promise<Place[]> {
  if (!olaEnabled() || query.trim().length < 3) return [];
  const base = process.env.OLA_MAPS_URL || "https://api.olamaps.io";
  const params = new URLSearchParams({ input: query });
  if (near) params.set("location", `${near[1].toFixed(5)},${near[0].toFixed(5)}`);
  const cacheKey = `${base}/places/v1/autocomplete?${params}`;
  params.set("api_key", process.env.OLA_MAPS_API_KEY!.trim());
  const url = `${base}/places/v1/autocomplete?${params}`;
  // Short cache: saves quota on repeated searches without keeping Ola's data long.
  const data = await cached("ola", cacheKey, 3600_000, async () => {
    if (!takeOlaQuota()) throw new UpstreamError("Ola Maps daily limit reached", "Ola Maps", 429);
    return fetchJson<OlaResponse>(url, { service: "Ola Maps", timeoutMs: 5000, retries: 0, init: { headers: { "X-Request-Id": randomUUID() } } });
  });
  if (data.status && !/^ok$/i.test(data.status) && !data.predictions?.length) {
    throw new UpstreamError(`Ola Maps: ${data.error_message || data.status}`, "Ola Maps");
  }
  return (data.predictions ?? []).map((p) => olaToPlace(p, near)).filter((p): p is Place => !!p);
}
