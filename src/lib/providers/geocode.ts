import type { LngLat } from "@/lib/geo";
import { cached, fetchJson } from "./http";

export interface Place {
  label: string;
  detail: string;
  lng: number;
  lat: number;
}

// India bounding box (Photon expects minLon,minLat,maxLon,maxLat).
const INDIA_BBOX = "68.1,6.5,97.5,35.7";

interface PhotonFeature {
  geometry: { coordinates: LngLat };
  properties: Record<string, string | undefined>;
}

/**
 * Search-as-you-type uses Photon, which is built for autocomplete; Nominatim's
 * usage policy forbids autocomplete traffic.
 */
export async function searchPlaces(query: string, near?: LngLat): Promise<Place[]> {
  const base = process.env.PHOTON_URL || "https://photon.komoot.io";
  const params = new URLSearchParams({ q: query, limit: "6", lang: "en", bbox: INDIA_BBOX });
  if (near) {
    params.set("lon", near[0].toFixed(4));
    params.set("lat", near[1].toFixed(4));
  }
  const url = `${base}/api/?${params}`;
  const data = await cached("photon", url, 24 * 3600_000, () =>
    fetchJson<{ features: PhotonFeature[] }>(url, { service: "search", timeoutMs: 8000 }),
  );
  return data.features.map((f) => {
    const p = f.properties;
    const label = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || p.city || "Unnamed place";
    const detail = [p.street && p.name ? p.street : undefined, p.district, p.city, p.state]
      .filter((x, i, arr) => x && arr.indexOf(x) === i && x !== label)
      .join(", ");
    return { label, detail, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
  });
}

export async function reverseGeocode(point: LngLat): Promise<Place> {
  const base = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
  const params = new URLSearchParams({
    lat: point[1].toFixed(5),
    lon: point[0].toFixed(5),
    format: "jsonv2",
    zoom: "17",
    "accept-language": "en",
  });
  const url = `${base}/reverse?${params}`;
  const data = await cached("nominatim-rev", url, 7 * 24 * 3600_000, () =>
    fetchJson<{ display_name?: string; name?: string; address?: Record<string, string> }>(url, {
      service: "reverse geocoding",
      timeoutMs: 8000,
    }),
  );
  const a = data.address ?? {};
  const label =
    data.name || a.road || a.neighbourhood || a.suburb || data.display_name?.split(",")[0] || "Current location";
  const detail = [a.suburb, a.city || a.town || a.village, a.state].filter(Boolean).join(", ");
  return { label, detail, lng: point[0], lat: point[1] };
}
