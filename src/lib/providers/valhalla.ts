import type { LngLat } from "@/lib/geo";
import { cached, endpoints, fetchJson, UpstreamError, withFailover } from "./http";
import type { RawRoute, TravelMode } from "./osrm";

interface ValhallaManeuver {
  instruction: string;
  length: number; // km
  time: number; // s
  begin_shape_index: number;
}

interface ValhallaTrip {
  status: number;
  legs: { shape: string; maneuvers: ValhallaManeuver[] }[];
  summary: { length: number; time: number };
}

interface ValhallaResponse {
  trip: ValhallaTrip;
  alternates?: { trip: ValhallaTrip }[];
}

/** Decode a Google-style encoded polyline (Valhalla uses precision 6). */
export function decodePolyline(encoded: string, precision = 6): LngLat[] {
  const factor = 10 ** precision;
  const out: LngLat[] = [];
  let lat = 0;
  let lng = 0;
  let i = 0;
  while (i < encoded.length) {
    for (const axis of [0, 1]) {
      let shift = 0;
      let result = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(i++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && i < encoded.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

export function parseValhallaTrip(trip: ValhallaTrip): RawRoute {
  const coordinates: LngLat[] = [];
  const steps: RawRoute["steps"] = [];
  trip.legs.forEach((leg, legIndex) => {
    const shape = decodePolyline(leg.shape);
    const offset = coordinates.length ? 1 : 0; // legs share their joining point
    coordinates.push(...shape.slice(offset));
    leg.maneuvers.forEach((m, mi) => {
      const isLast = mi === leg.maneuvers.length - 1;
      // Skip the arrive/depart pair Valhalla inserts at intermediate via points.
      if (isLast && legIndex < trip.legs.length - 1) return;
      if (mi === 0 && legIndex > 0) return;
      steps.push({
        instruction: m.instruction,
        distance: m.length * 1000,
        duration: m.time,
        location: shape[Math.min(m.begin_shape_index, shape.length - 1)],
      });
    });
  });
  return { coordinates, distance: trip.summary.length * 1000, duration: trip.summary.time, steps };
}

/**
 * Valhalla on the FOSSGIS servers, a different engine over the same OpenStreetMap
 * data. Used when every OSRM endpoint has failed, and for step-free walking routes.
 */
export async function valhallaRoute(
  points: LngLat[],
  mode: TravelMode,
  alternatives: number,
  { wheelchair = false }: { wheelchair?: boolean } = {},
): Promise<RawRoute[]> {
  const body = {
    locations: points.map(([lon, lat], i) => ({ lat, lon, type: i === 0 || i === points.length - 1 ? "break" : "through" })),
    costing: mode === "walk" ? "pedestrian" : "auto",
    // Valhalla's wheelchair pedestrian type avoids steps and rough surfaces.
    ...(mode === "walk" && wheelchair ? { costing_options: { pedestrian: { type: "wheelchair", step_penalty: 3600 } } } : {}),
    alternates: points.length === 2 ? alternatives : 0,
    units: "kilometers",
    directions_options: { units: "kilometers", language: "en-US" },
  };
  const query = `json=${encodeURIComponent(JSON.stringify(body))}`;
  try {
    const data = await withFailover(endpoints(process.env.VALHALLA_URL, ["https://valhalla1.openstreetmap.de"]), (base) =>
      cached("valhalla", `${base}?${query}`, 6 * 3600_000, () =>
        fetchJson<ValhallaResponse>(`${base}/route?${query}`, { service: "routing", timeoutMs: 12_000, retries: 0 }),
      ),
    );
    return [data.trip, ...(data.alternates ?? []).map((a) => a.trip)].filter((t) => t.status === 0).map(parseValhallaTrip);
  } catch (err) {
    // Valhalla answers 400 when no path exists between the points.
    if (err instanceof UpstreamError && err.status === 400) return [];
    throw err;
  }
}
