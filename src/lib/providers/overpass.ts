import { simplify, type LngLat } from "@/lib/geo";
import { cached, fetchJson } from "./http";

export type PoiKind =
  | "lamp"
  | "cctv"
  | "police"
  | "hospital"
  | "clinic"
  | "pharmacy"
  | "fuel"
  | "bank"
  | "atm"
  | "food"
  | "venue"
  | "worship"
  | "shop"
  | "transit";

export interface Poi {
  id: string;
  kind: PoiKind;
  point: LngLat;
  name?: string;
  openingHours?: string;
  phone?: string;
}

export interface Road {
  id: string;
  tags: Record<string, string>;
  geometry: LngLat[];
}

export type AreaKind = "industrial" | "cemetery" | "wasteland" | "construction" | "railway" | "military" | "park" | "woods";

export interface Area {
  id: string;
  kind: AreaKind;
  ring: LngLat[];
}

export interface OsmFeatures {
  roads: Road[];
  pois: Poi[];
  areas: Area[];
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

const FOOTFALL_AMENITIES =
  "restaurant|cafe|fast_food|food_court|bar|pub|ice_cream|pharmacy|bank|atm|fuel|marketplace|cinema|theatre|clinic|doctors|place_of_worship|bus_station|police|hospital";

/** Overpass `around` accepts a polyline: lat1,lon1,lat2,lon2,… */
function aroundLine(line: LngLat[]) {
  return line.map(([lng, lat]) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join(",");
}

/** Simplify until the polyline is short enough to keep the query small. */
export function queryLine(route: LngLat[], maxPoints = 120): LngLat[] {
  let tolerance = 5;
  let line = simplify(route, tolerance);
  while (line.length > maxPoints && tolerance < 200) {
    tolerance *= 1.6;
    line = simplify(route, tolerance);
  }
  return line;
}

export function buildRouteQuery(routes: LngLat[][]): string {
  const lines = routes.map((r) => aroundLine(queryLine(r)));
  const each = (fn: (l: string) => string) => lines.map(fn).join("\n  ");
  return `[out:json][timeout:45][maxsize:134217728];
(
  ${each((l) => `way(around:25,${l})[highway];`)}
);
out tags geom qt;
(
  ${each((l) => `node(around:40,${l})[highway=street_lamp];`)}
  ${each((l) => `node(around:50,${l})[man_made=surveillance];`)}
  ${each((l) => `nwr(around:60,${l})[shop];`)}
  ${each((l) => `nwr(around:60,${l})[amenity~"^(${FOOTFALL_AMENITIES})$"];`)}
  ${each((l) => `nwr(around:150,${l})[highway=bus_stop];`)}
  ${each((l) => `nwr(around:150,${l})[public_transport~"^(platform|station)$"];`)}
  ${each((l) => `nwr(around:150,${l})[railway~"^(station|halt|subway_entrance|tram_stop)$"];`)}
  ${each((l) => `nwr(around:1500,${l})[amenity=police];`)}
  ${each((l) => `nwr(around:1000,${l})[amenity=hospital];`)}
);
out tags center qt;
(
  ${each((l) => `way(around:20,${l})[landuse~"^(industrial|cemetery|brownfield|construction|quarry|railway|military|landfill)$"];`)}
  ${each((l) => `way(around:20,${l})[leisure~"^(park|nature_reserve)$"];`)}
  ${each((l) => `way(around:20,${l})[natural~"^(wood|scrub|wetland|heath)$"];`)}
  ${each((l) => `way(around:20,${l})[amenity=grave_yard];`)}
);
out tags geom qt;`;
}

export function buildNearbyHelpQuery(point: LngLat, radiusM: number): string {
  const at = `${point[1].toFixed(6)},${point[0].toFixed(6)}`;
  return `[out:json][timeout:25];
(
  nwr(around:${radiusM},${at})[amenity=police];
  nwr(around:${radiusM},${at})[amenity=hospital];
  nwr(around:${Math.min(radiusM, 1500)},${at})[amenity=pharmacy][opening_hours="24/7"];
  nwr(around:${Math.min(radiusM, 1500)},${at})[amenity=fuel];
);
out tags center qt;`;
}

const ROAD_TAGS = new Set([
  "highway",
  "lit",
  "sidewalk",
  "sidewalk:both",
  "sidewalk:left",
  "sidewalk:right",
  "footway",
  "foot",
  "tunnel",
  "bridge",
  "name",
  "surface",
  "access",
]);

export function classifyPoi(tags: Record<string, string>): PoiKind | null {
  if (tags.highway === "street_lamp") return "lamp";
  if (tags.man_made === "surveillance") return "cctv";
  if (tags.highway === "bus_stop" || tags.public_transport || tags.railway) return "transit";
  switch (tags.amenity) {
    case "police":
      return "police";
    case "hospital":
      return "hospital";
    case "clinic":
    case "doctors":
      return "clinic";
    case "pharmacy":
      return "pharmacy";
    case "fuel":
      return "fuel";
    case "bank":
      return "bank";
    case "atm":
      return "atm";
    case "restaurant":
    case "cafe":
    case "fast_food":
    case "food_court":
    case "bar":
    case "pub":
    case "ice_cream":
      return "food";
    case "marketplace":
    case "cinema":
    case "theatre":
      return "venue";
    case "place_of_worship":
      return "worship";
    case "bus_station":
      return "transit";
  }
  if (tags.shop) return "shop";
  return null;
}

export function classifyArea(tags: Record<string, string>): AreaKind | null {
  switch (tags.landuse) {
    case "industrial":
      return "industrial";
    case "cemetery":
      return "cemetery";
    case "brownfield":
    case "landfill":
    case "quarry":
      return "wasteland";
    case "construction":
      return "construction";
    case "railway":
      return "railway";
    case "military":
      return "military";
  }
  if (tags.amenity === "grave_yard") return "cemetery";
  if (tags.leisure === "park" || tags.leisure === "nature_reserve") return "park";
  if (tags.natural && ["wood", "scrub", "wetland", "heath"].includes(tags.natural)) return "woods";
  return null;
}

export function parseOverpass(elements: OverpassElement[]): OsmFeatures {
  const roads: Road[] = [];
  const pois: Poi[] = [];
  const areas: Area[] = [];
  const seen = new Set<string>();

  for (const el of elements) {
    const id = `${el.type[0]}${el.id}`;
    const tags = el.tags ?? {};
    const key = `${id}:${el.geometry ? "g" : "c"}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (el.geometry && el.geometry.length >= 2) {
      const geometry: LngLat[] = el.geometry.map((g) => [g.lon, g.lat]);
      const areaKind = classifyArea(tags);
      if (areaKind) {
        const closed = geometry.length >= 4 && geometry[0][0] === geometry.at(-1)![0] && geometry[0][1] === geometry.at(-1)![1];
        if (closed) areas.push({ id, kind: areaKind, ring: geometry });
        continue;
      }
      if (tags.highway) {
        const kept: Record<string, string> = {};
        for (const [k, v] of Object.entries(tags)) if (ROAD_TAGS.has(k)) kept[k] = v;
        roads.push({ id, tags: kept, geometry });
      }
      continue;
    }

    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const kind = classifyPoi(tags);
    if (!kind) continue;
    pois.push({
      id,
      kind,
      point: [lon, lat],
      name: tags.name || tags["name:en"],
      openingHours: tags.opening_hours,
      phone: tags.phone || tags["contact:phone"],
    });
  }
  return { roads, pois, areas };
}

function overpassUrl() {
  return process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
}

async function runQuery(query: string, ttlMs: number) {
  return cached("overpass", query, ttlMs, () =>
    fetchJson<{ elements: OverpassElement[] }>(overpassUrl(), {
      service: "OpenStreetMap data",
      timeoutMs: 50_000,
      retries: 2,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      },
    }),
  );
}

/** Street-level features around each candidate route, in a single Overpass request. */
export async function fetchRouteFeatures(routes: LngLat[][]): Promise<OsmFeatures> {
  const data = await runQuery(buildRouteQuery(routes), 24 * 3600_000);
  return parseOverpass(data.elements);
}

export async function fetchNearbyHelp(point: LngLat, radiusM = 3000): Promise<Poi[]> {
  const data = await runQuery(buildNearbyHelpQuery(point, radiusM), 24 * 3600_000);
  return parseOverpass(data.elements).pois;
}
