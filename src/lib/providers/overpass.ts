import { simplify, type BBox, type LngLat } from "@/lib/geo";
import { cached, endpoints, fetchJson, SkipEndpoint, UpstreamError, withFailover } from "./http";

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
  /** Footprint bounds of buildings near the route: homes and shops facing the street. */
  buildings?: BBox[];
  /** "tiles" when Overpass was unavailable and vector tiles were used (no lamps, lit tags or opening hours). */
  source?: "overpass" | "tiles";
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  members?: { type: string; ref: number; role: string; geometry?: { lat: number; lon: number }[] }[];
  tags?: Record<string, string>;
}

/**
 * Buildings that put people's eyes on the street. Factories, warehouses, sheds and
 * garages are excluded: they are empty after hours.
 */
const BUILDING_FILTER = `[building][building!~"^(industrial|warehouse|factory|manufacture|garage|garages|shed|roof|ruins|construction|storage_tank|silo|hangar|transformer_tower|carport)$"]`;

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
  ${each((l) => `rel(around:20,${l})[type=multipolygon][landuse~"^(industrial|cemetery|military|railway|construction)$"];`)}
  ${each((l) => `rel(around:20,${l})[type=multipolygon][leisure=park];`)}
);
out tags geom qt;
(
  ${each((l) => `way(around:30,${l})${BUILDING_FILTER};`)}
);
out ids bb qt;`;
}

/** Everything needed to judge the streets around one point right now. */
export function buildAreaQuery(point: LngLat): string {
  const at = `${point[1].toFixed(5)},${point[0].toFixed(5)}`;
  return `[out:json][timeout:30][maxsize:67108864];
way(around:180,${at})[highway];
out tags geom qt;
(
  node(around:200,${at})[highway=street_lamp];
  node(around:200,${at})[man_made=surveillance];
  nwr(around:200,${at})[shop];
  nwr(around:200,${at})[amenity~"^(${FOOTFALL_AMENITIES})$"];
  nwr(around:400,${at})[highway=bus_stop];
  nwr(around:400,${at})[public_transport~"^(platform|station)$"];
  nwr(around:400,${at})[railway~"^(station|halt|subway_entrance|tram_stop)$"];
  nwr(around:2000,${at})[amenity=police];
  nwr(around:1500,${at})[amenity=hospital];
  nwr(around:1000,${at})[amenity~"^(pharmacy|fuel)$"];
);
out tags center qt;
(
  way(around:60,${at})[landuse~"^(industrial|cemetery|brownfield|construction|quarry|railway|military|landfill)$"];
  way(around:60,${at})[leisure~"^(park|nature_reserve)$"];
  way(around:60,${at})[natural~"^(wood|scrub|wetland|heath)$"];
  way(around:60,${at})[amenity=grave_yard];
  rel(around:60,${at})[type=multipolygon][landuse~"^(industrial|cemetery|military|railway|construction)$"];
  rel(around:60,${at})[type=multipolygon][leisure=park];
);
out tags geom qt;
way(around:200,${at})${BUILDING_FILTER};
out ids bb qt;`;
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
  "smoothness",
  "wheelchair",
  "service",
  "lanes",
  "maxspeed",
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

/** Join a relation's outer member ways into closed rings (inner rings are ignored: conservative). */
export function assembleRings(members: NonNullable<OverpassElement["members"]>): LngLat[][] {
  const same = (a: LngLat, b: LngLat) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  const parts: LngLat[][] = members
    .filter((m) => m.type === "way" && m.role !== "inner" && m.geometry && m.geometry.length >= 2)
    .map((m) => m.geometry!.map((g) => [g.lon, g.lat] as LngLat));
  const rings: LngLat[][] = [];
  while (parts.length) {
    let ring = parts.shift()!;
    let grew = true;
    while (!same(ring[0], ring.at(-1)!) && grew) {
      grew = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const end = ring.at(-1)!;
        if (same(p[0], end)) ring = [...ring, ...p.slice(1)];
        else if (same(p.at(-1)!, end)) ring = [...ring, ...p.slice(0, -1).reverse()];
        else continue;
        parts.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && same(ring[0], ring.at(-1)!)) rings.push(ring);
  }
  return rings;
}

export function parseOverpass(elements: OverpassElement[]): OsmFeatures {
  const roads: Road[] = [];
  const pois: Poi[] = [];
  const areas: Area[] = [];
  const buildings: BBox[] = [];
  const seen = new Set<string>();

  for (const el of elements) {
    const id = `${el.type[0]}${el.id}`;
    const tags = el.tags ?? {};
    // Buildings come from an `out ids bb` block: bounds and no tags.
    const isBuilding = !el.tags && !el.geometry && !!el.bounds;
    const key = `${id}:${isBuilding ? "b" : el.geometry ? "g" : "c"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isBuilding) {
      const b = el.bounds!;
      buildings.push({ minLng: b.minlon, minLat: b.minlat, maxLng: b.maxlon, maxLat: b.maxlat });
      continue;
    }

    // Large estates, parks and cemeteries are often multipolygon relations.
    if (el.type === "relation" && el.members) {
      const kind = classifyArea(tags);
      if (kind) for (const ring of assembleRings(el.members)) areas.push({ id: `${id}:${areas.length}`, kind, ring });
      continue;
    }

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
  return { roads, pois, areas, buildings };
}

/**
 * Public Overpass instances listed on the OSM wiki; OVERPASS_URL (comma-separated)
 * overrides them. OpenStreetMap France's instance comes first: it answers cloud
 * servers, while the main instance often turns them away when at capacity.
 */
export const OVERPASS_MIRRORS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

interface OverpassResponse {
  elements: OverpassElement[];
  remark?: string;
}

/**
 * Overpass reports timeouts and memory exhaustion as HTTP 200 with a "runtime error"
 * remark and partial (often empty) results. Scoring those would rate every street on
 * priors alone, so they are treated as a failure and the next mirror is tried.
 */
export function assertCompleteOverpass(data: OverpassResponse): OverpassResponse {
  if (data.remark && /runtime error|out of memory|timed out/i.test(data.remark)) {
    throw new UpstreamError(`OpenStreetMap data: ${data.remark.slice(0, 120)}`, "OpenStreetMap data", 504);
  }
  return data;
}

/** Total time allowed across all mirrors, so a plan request finishes within the function limit. */
const OVERPASS_BUDGET_MS = 45_000;

async function runQuery(query: string, ttlMs: number) {
  return cached("overpass", query, ttlMs, () => {
    const deadline = Date.now() + OVERPASS_BUDGET_MS;
    return withFailover(endpoints(process.env.OVERPASS_URL, OVERPASS_MIRRORS), async (url, remaining) => {
      const left = deadline - Date.now();
      if (left < 5_000) throw new SkipEndpoint("OpenStreetMap data: out of time");
      return assertCompleteOverpass(
        await fetchJson<OverpassResponse>(url, {
          service: "OpenStreetMap data",
          // A fair share of what's left, so one hanging mirror can't starve the others.
          timeoutMs: Math.min(40_000, left, Math.max(20_000, left / remaining)),
          // The next mirror is the retry.
          retries: 0,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `data=${encodeURIComponent(query)}`,
          },
        }),
      );
    }, Date.now, "OpenStreetMap data");
  });
}

/** Street-level features around each candidate route, in a single Overpass request. */
export async function fetchRouteFeatures(routes: LngLat[][]): Promise<OsmFeatures> {
  const data = await runQuery(buildRouteQuery(routes), 24 * 3600_000);
  return parseOverpass(data.elements);
}

/** Street data around one point, rounded to ~100 m so neighbours share the cache. */
export async function fetchAreaFeatures(point: LngLat): Promise<OsmFeatures> {
  const at: LngLat = [Math.round(point[0] * 1000) / 1000, Math.round(point[1] * 1000) / 1000];
  const data = await runQuery(buildAreaQuery(at), 24 * 3600_000);
  return parseOverpass(data.elements);
}

export async function fetchNearbyHelp(point: LngLat, radiusM = 3000): Promise<Poi[]> {
  const data = await runQuery(buildNearbyHelpQuery(point, radiusM), 24 * 3600_000);
  return parseOverpass(data.elements).pois;
}
