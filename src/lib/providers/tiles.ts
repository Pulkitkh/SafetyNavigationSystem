/**
 * Street data from OpenStreetMap vector tiles (OpenMapTiles schema), served free
 * by the OpenFreeMap CDN. Used when the Overpass servers are slow or blocked.
 *
 * Tiles carry road classes, footpaths and steps, surfaces, tunnels, points of
 * interest with names, building footprints and land use. They do not carry
 * street lamps, `lit`/`sidewalk` tags or opening hours, so scores built from
 * them lean on the conservative priors and report lower confidence.
 */
import { VectorTile, type VectorTileFeature } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import type { BBox, LngLat } from "@/lib/geo";
import { cached, fetchJson, UpstreamError, userAgent } from "./http";
import { classifyArea, classifyPoi, type Area, type OsmFeatures, type Poi, type Road } from "./overpass";

export const TILE_ZOOM = 14;
const MAX_TILES = 30;
const TILEJSON_URL = () => process.env.TILES_TILEJSON_URL || "https://tiles.openfreemap.org/planet";

// ---------------------------------------------------------------------------
// Tile maths (Web Mercator)
// ---------------------------------------------------------------------------

export function lngLatToTile(lng: number, lat: number, z = TILE_ZOOM): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}

function tilePointToLngLat(z: number, x: number, y: number, extent: number, px: number, py: number): LngLat {
  const n = 2 ** z;
  const lng = ((x + px / extent) / n) * 360 - 180;
  const merc = Math.PI * (1 - (2 * (y + py / extent)) / n);
  const lat = (Math.atan(Math.sinh(merc)) * 180) / Math.PI;
  return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
}

/** Tiles touched by `points`, each widened by `bufferM` metres in every direction. */
export function tilesAround(points: LngLat[], bufferM: number, z = TILE_ZOOM): string[] {
  const set = new Set<string>();
  const dLat = bufferM / 111_320;
  for (const [lng, lat] of points) {
    const dLng = bufferM / (111_320 * Math.cos((lat * Math.PI) / 180));
    const [x0, y1] = lngLatToTile(lng - dLng, lat - dLat, z);
    const [x1, y0] = lngLatToTile(lng + dLng, lat + dLat, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) set.add(`${x}/${y}`);
  }
  return [...set];
}

// ---------------------------------------------------------------------------
// Decoding: OpenMapTiles layers → the same shapes the Overpass parser produces
// ---------------------------------------------------------------------------

const AMENITY_SUBCLASSES = new Set([
  "police",
  "hospital",
  "clinic",
  "doctors",
  "pharmacy",
  "fuel",
  "bank",
  "atm",
  "restaurant",
  "cafe",
  "fast_food",
  "food_court",
  "bar",
  "pub",
  "ice_cream",
  "marketplace",
  "cinema",
  "theatre",
  "place_of_worship",
  "bus_station",
]);
const SHOP_CLASSES = new Set([
  "shop",
  "grocery",
  "alcohol_shop",
  "bakery",
  "butcher",
  "clothing_store",
  "jewelry",
  "mobile_phone",
  "hardware",
  "music",
  "laundry",
  "florist",
  "furniture",
  "car",
  "bicycle",
]);

/** Rebuild the OSM tags a POI came from, so the Overpass classifier can be reused. */
export function poiTags(cls: string, subclass: string): Record<string, string> | null {
  if (AMENITY_SUBCLASSES.has(subclass)) return { amenity: subclass };
  if (subclass === "bus_stop") return { highway: "bus_stop" };
  if (["station", "halt", "subway_entrance", "tram_stop"].includes(subclass) && (cls === "railway" || cls === "entrance" || cls === "bus" || cls === "tram")) {
    return { railway: subclass };
  }
  if (SHOP_CLASSES.has(cls) || subclass === "books" || subclass === "supermarket" || subclass === "convenience") return { shop: subclass || cls };
  return null;
}

/** Road tags from the transportation layer; null for rail, ferries and other non-walkable lines. */
export function roadTags(p: Record<string, unknown>): Record<string, string> | null {
  const cls = String(p.class ?? "");
  const sub = String(p.subclass ?? "");
  let highway: string;
  if (["motorway", "trunk", "primary", "secondary", "tertiary"].includes(cls)) highway = cls + (p.ramp ? "_link" : "");
  else if (cls === "minor") highway = "residential";
  else if (cls === "service") highway = "service";
  else if (cls === "track") highway = "track";
  else if (cls === "path") highway = ["platform", "corridor"].includes(sub) ? "footway" : sub || "path";
  else return null;
  const tags: Record<string, string> = { highway };
  if (p.brunnel === "tunnel") tags.tunnel = "yes";
  if (p.brunnel === "bridge") tags.bridge = "yes";
  if (p.surface === "unpaved") tags.surface = "unpaved";
  if (typeof p.service === "string" && p.service) tags.service = p.service;
  if (p.access === "no" || p.access === "private") tags.access = String(p.access);
  return tags;
}

function ringArea(r: { x: number; y: number }[]) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j].x - r[i].x) * (r[j].y + r[i].y);
  return a;
}

export interface TileFeatures {
  roads: Road[];
  pois: Poi[];
  areas: Area[];
  buildings: BBox[];
}

export function decodeTile(data: Uint8Array, z: number, x: number, y: number): TileFeatures {
  const tile = new VectorTile(new PbfReader(data));
  const out: TileFeatures = { roads: [], pois: [], areas: [], buildings: [] };
  const toLngLat = (extent: number) => (pt: { x: number; y: number }) => tilePointToLngLat(z, x, y, extent, pt.x, pt.y);
  const id = (layer: string, i: number) => `t${z}/${x}/${y}/${layer[0]}${i}`;

  const transport = tile.layers.transportation;
  for (let i = 0; transport && i < transport.length; i++) {
    const f = transport.feature(i);
    const tags = roadTags(f.properties);
    if (!tags || tags.access) continue;
    for (const line of f.loadGeometry()) {
      if (line.length >= 2) out.roads.push({ id: id("road", i) + `:${out.roads.length}`, tags, geometry: line.map(toLngLat(transport.extent)) });
    }
  }

  const poi = tile.layers.poi;
  for (let i = 0; poi && i < poi.length; i++) {
    const f = poi.feature(i);
    const tags = poiTags(String(f.properties.class ?? ""), String(f.properties.subclass ?? ""));
    const kind = tags && classifyPoi(tags);
    if (!kind) continue;
    const pt = f.loadGeometry()[0]?.[0];
    if (!pt) continue;
    const name = (f.properties["name:en"] || f.properties.name || f.properties.name_int) as string | undefined;
    out.pois.push({ id: id("poi", i), kind, point: toLngLat(poi.extent)(pt), name: name || undefined });
  }

  // Land use that empties out after dark, from three layers.
  const areaLayers: [string, (f: VectorTileFeature) => Record<string, string>][] = [
    ["landuse", (f) => ({ landuse: String(f.properties.class ?? "") })],
    ["park", (f) => ({ leisure: f.properties.class === "nature_reserve" ? "nature_reserve" : "park" })],
    [
      "landcover",
      (f): Record<string, string> =>
        f.properties.class === "wood" || f.properties.class === "wetland" ? { natural: String(f.properties.class) } : f.properties.subclass === "park" ? { leisure: "park" } : {},
    ],
  ];
  for (const [name, toTags] of areaLayers) {
    const layer = tile.layers[name];
    for (let i = 0; layer && i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 3) continue;
      const kind = classifyArea(toTags(f));
      if (!kind) continue;
      // Outer rings only (clockwise in tile coordinates); holes are ignored, which is conservative.
      for (const ring of f.loadGeometry()) {
        if (ring.length >= 4 && ringArea(ring) > 0) out.areas.push({ id: id(name, i) + `:${out.areas.length}`, kind, ring: ring.map(toLngLat(layer.extent)) });
      }
    }
  }

  const building = tile.layers.building;
  for (let i = 0; building && i < building.length; i++) {
    const f = building.feature(i);
    for (const ring of f.loadGeometry()) {
      if (ring.length < 3 || ringArea(ring) <= 0) continue;
      const pts = ring.map(toLngLat(building.extent));
      out.buildings.push({
        minLng: Math.min(...pts.map((p) => p[0])),
        minLat: Math.min(...pts.map((p) => p[1])),
        maxLng: Math.max(...pts.map((p) => p[0])),
        maxLat: Math.max(...pts.map((p) => p[1])),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function tileUrlTemplate(): Promise<string> {
  const tj = await cached("tilejson", TILEJSON_URL(), 6 * 3600_000, () => fetchJson<{ tiles: string[] }>(TILEJSON_URL(), { service: "map tiles", timeoutMs: 8000 }));
  if (!tj.tiles?.[0]) throw new UpstreamError("map tiles: no tile URL", "map tiles");
  return tj.tiles[0];
}

async function loadTile(template: string, key: string): Promise<TileFeatures> {
  const [x, y] = key.split("/").map(Number);
  const url = template.replace("{z}", String(TILE_ZOOM)).replace("{x}", String(x)).replace("{y}", String(y));
  // The decoded tile is cached (tiles are rebuilt weekly), so each is fetched once.
  return cached("tile", url, 3 * 24 * 3600_000, async () => {
    const res = await fetch(url, { headers: { "User-Agent": userAgent() }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 204 || res.status === 404) return { roads: [], pois: [], areas: [], buildings: [] };
    if (!res.ok) throw new UpstreamError(`map tiles responded ${res.status}`, "map tiles", res.status);
    return decodeTile(new Uint8Array(await res.arrayBuffer()), TILE_ZOOM, x, y);
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Merge tiles, dropping the copies of points that sit in two tiles' overlapping buffers. */
export function mergeTiles(parts: TileFeatures[], helpOnly: TileFeatures[] = []): OsmFeatures {
  const pois: Poi[] = [];
  const seenPoi = new Set<string>();
  const addPoi = (p: Poi) => {
    const k = `${p.kind}:${p.name ?? ""}:${p.point[0].toFixed(5)}:${p.point[1].toFixed(5)}`;
    if (!seenPoi.has(k)) {
      seenPoi.add(k);
      pois.push(p);
    }
  };
  parts.forEach((t) => t.pois.forEach(addPoi));
  // Outer tiles contribute only places of help, which matter up to ~1.5 km away.
  helpOnly.forEach((t) => t.pois.filter((p) => ["police", "hospital", "pharmacy", "fuel"].includes(p.kind)).forEach(addPoi));
  const seenB = new Set<string>();
  const buildings = parts
    .flatMap((t) => t.buildings)
    .filter((b) => {
      const k = `${b.minLng.toFixed(5)}:${b.minLat.toFixed(5)}`;
      if (seenB.has(k)) return false;
      seenB.add(k);
      return true;
    });
  return { roads: parts.flatMap((t) => t.roads), pois, areas: parts.flatMap((t) => t.areas), buildings, source: "tiles" };
}

/**
 * Street features from vector tiles: full detail within `nearM` of the points,
 * places of help up to `helpM` away.
 */
export async function fetchTileFeatures(points: LngLat[], nearM = 400, helpM = 1500): Promise<OsmFeatures> {
  const template = await tileUrlTemplate();
  const near = tilesAround(points, nearM);
  if (near.length > MAX_TILES) throw new UpstreamError("map tiles: area too large", "map tiles");
  const help = tilesAround(points, helpM).filter((k) => !near.includes(k)).slice(0, Math.max(0, MAX_TILES - near.length));
  const [a, b] = await Promise.all([mapLimit(near, 6, (k) => loadTile(template, k)), mapLimit(help, 6, (k) => loadTile(template, k).catch(() => null))]);
  return mergeTiles(a, b.filter((t): t is TileFeatures => !!t));
}
