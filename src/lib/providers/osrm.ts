import type { LngLat } from "@/lib/geo";
import { cached, endpoints, fetchJson, UpstreamError, withFailover } from "./http";
import { valhallaRoute } from "./valhalla";

export type TravelMode = "walk" | "ride";

export interface RouteStep {
  instruction: string;
  distance: number;
  duration: number;
  location: LngLat;
}

export interface RawRoute {
  coordinates: LngLat[];
  distance: number; // metres
  duration: number; // seconds
  steps: RouteStep[];
}

interface OsrmStep {
  distance: number;
  duration: number;
  name: string;
  ref?: string;
  mode: string;
  maneuver: { type: string; modifier?: string; location: LngLat; exit?: number };
}

interface OsrmResponse {
  code: string;
  message?: string;
  routes: {
    distance: number;
    duration: number;
    geometry: { type: "LineString"; coordinates: LngLat[] };
    legs: { steps: OsrmStep[] }[];
  }[];
}

export function osrmBases(mode: TravelMode): string[] {
  return mode === "walk"
    ? endpoints(process.env.OSRM_FOOT_URL, ["https://routing.openstreetmap.de/routed-foot"])
    : endpoints(process.env.OSRM_CAR_URL, ["https://routing.openstreetmap.de/routed-car", "https://router.project-osrm.org"]);
}

/**
 * Route through `points` (start, optional vias, end). OSRM mirrors are tried in
 * order; if all fail, Valhalla (a different engine on the same OSM data) is used,
 * so routing keeps working when one public server is down or rate-limited.
 */
export async function osrmRoute(points: LngLat[], mode: TravelMode, alternatives: number): Promise<RawRoute[]> {
  try {
    return await withFailover(osrmBases(mode), (base) => osrmRouteAt(base, points, alternatives));
  } catch (err) {
    if (process.env.VALHALLA_URL === "off") throw err;
    console.warn(`[routing] OSRM failed (${(err as Error).message}); falling back to Valhalla`);
    return valhallaRoute(points, mode, alternatives);
  }
}

/**
 * The FOSSGIS instances serve each profile under its own path but keep "driving"
 * as the profile segment of the URL.
 */
async function osrmRouteAt(base: string, points: LngLat[], alternatives: number): Promise<RawRoute[]> {
  const coords = points.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
  const params = new URLSearchParams({
    overview: "full",
    geometries: "geojson",
    steps: "true",
    alternatives: alternatives > 0 && points.length === 2 ? String(alternatives) : "false",
  });
  const url = `${base}/route/v1/driving/${coords}?${params}`;
  const data = await cached("osrm", url, 6 * 3600_000, () =>
    fetchJson<OsrmResponse>(url, { service: "routing", timeoutMs: 10_000 }),
  );
  if (data.code !== "Ok") {
    if (data.code === "NoRoute") return [];
    throw new UpstreamError(`routing: ${data.code} ${data.message ?? ""}`.trim(), "routing");
  }
  return data.routes.map((r) => ({
    coordinates: r.geometry.coordinates,
    distance: r.distance,
    duration: r.duration,
    steps: r.legs
      .flatMap((leg, legIndex, legs) =>
        leg.steps.filter((s) => {
          // Drop the arrive/depart pair that OSRM inserts at intermediate via points.
          if (legIndex < legs.length - 1 && s.maneuver.type === "arrive") return false;
          if (legIndex > 0 && s.maneuver.type === "depart") return false;
          return true;
        }),
      )
      .map((s) => ({
        instruction: describeStep(s),
        distance: s.distance,
        duration: s.duration,
        location: s.maneuver.location,
      })),
  }));
}

/** Human-readable instruction from an OSRM maneuver (OSRM itself returns no text). */
export function describeStep(step: Pick<OsrmStep, "name" | "ref" | "maneuver">): string {
  const road = step.name || step.ref || "";
  const onto = road ? ` onto ${road}` : "";
  const { type, modifier, exit } = step.maneuver;
  const dir = modifier ? modifier.replace("slight ", "slightly ") : "";
  switch (type) {
    case "depart":
      return road ? `Head out on ${road}` : "Start walking";
    case "arrive":
      return "You have arrived at your destination";
    case "turn":
    case "end of road":
      if (modifier === "uturn") return `Make a U-turn${onto}`;
      if (modifier === "straight") return `Continue straight${onto}`;
      return `Turn ${dir}${onto}`;
    case "continue":
    case "new name":
      return modifier && modifier !== "straight" ? `Bear ${dir}${onto}` : `Continue${onto}`;
    case "fork":
      return `Keep ${modifier?.includes("left") ? "left" : modifier?.includes("right") ? "right" : "straight"} at the fork${onto}`;
    case "merge":
      return `Merge${onto}`;
    case "on ramp":
      return `Take the ramp${onto}`;
    case "off ramp":
      return `Take the exit${onto}`;
    case "roundabout":
    case "rotary":
    case "roundabout turn":
      return exit ? `At the roundabout, take exit ${exit}${onto}` : `Go through the roundabout${onto}`;
    case "exit roundabout":
    case "exit rotary":
      return `Exit the roundabout${onto}`;
    default:
      return modifier ? `Go ${dir}${onto}` : `Continue${onto}`;
  }
}
