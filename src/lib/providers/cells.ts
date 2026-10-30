/**
 * Street data store. OpenStreetMap features are fetched from Overpass in fixed
 * map cells (zoom-15 tiles, about 1.1 km across in India) and kept in Postgres,
 * so each part of a city is downloaded once, survives restarts and is shared by
 * every plan and area check. Compared with one query per route this means:
 *
 *  - the full street network around a trip is available, so the safest path
 *    can be searched for instead of only checking the fastest few;
 *  - a busy or unreachable Overpass server only matters for cells never seen
 *    before, and those fall back to vector tiles cell by cell.
 *
 * A second, lighter layer of zoom-13 cells (about 4.5 km) holds only places
 * of help (police, hospitals, pharmacies, petrol pumps), which matter up to
 * 2 km from a route.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { haversine, pointToSegment, simplify, type BBox, type LngLat } from "@/lib/geo";
import { overpassRequest, parseOverpass, type Area, type OsmFeatures, type Place, type Poi, type Road } from "./overpass";
import { lngLatToTile, tileBounds, tileFeaturesWithin } from "./tiles";

export const CELL_ZOOM = 15;
export const HELP_ZOOM = 13;
/** Cells are refreshed in the background after this long; OSM changes slowly. */
export const CELL_FRESH_MS = 30 * 24 * 3600_000;
/** Cells not used for this long are deleted. */
const CELL_UNUSED_MS = 120 * 24 * 3600_000;
/** Upper bound on stored cells (each is ~20–150 kB compressed). */
const MAX_CELLS = Number(process.env.OSM_MAX_CELLS) || 2500;
/** Overpass asks for no more than two parallel queries per client. */
const FETCH_CONCURRENCY = 2;
/** After a cell fails to download, wait this long before trying it again. */
const FAILED_RETRY_MS = 3 * 60_000;
/**
 * A cell refused only because every Overpass mirror is cooling down (one slow
 * answer opens the circuit breaker for all requests) is retried in the
 * background once the cool-down is over, rather than waiting for the next visitor.
 */
const BREAKER_RETRY_MS = 75_000;

export type Layer = "full" | "help";

export interface CellRef {
  key: string;
  z: number;
  x: number;
  y: number;
  bbox: BBox;
}

export function cellRef(z: number, x: number, y: number): CellRef {
  return { key: `${z}/${x}/${y}`, z, x, y, bbox: tileBounds(z, x, y) };
}

export function cellAt(p: LngLat, z = CELL_ZOOM): CellRef {
  const [x, y] = lngLatToTile(p[0], p[1], z);
  return cellRef(z, x, y);
}

/** Cells overlapping a box. */
export function cellsInBox(b: BBox, z = CELL_ZOOM): CellRef[] {
  const [x0, y0] = lngLatToTile(b.minLng, b.maxLat, z);
  const [x1, y1] = lngLatToTile(b.maxLng, b.minLat, z);
  const out: CellRef[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(cellRef(z, x, y));
  return out;
}

function boxDistance(p: LngLat, b: BBox) {
  const lng = Math.min(Math.max(p[0], b.minLng), b.maxLng);
  const lat = Math.min(Math.max(p[1], b.minLat), b.maxLat);
  return haversine(p, [lng, lat]);
}

/** Distance from a cell to a polyline (0 if the line crosses it), sampled at the line's vertices and cell corners. */
function cellToLine(c: CellRef, line: LngLat[]): number {
  let best = Infinity;
  for (const p of line) best = Math.min(best, boxDistance(p, c.bbox));
  const corners: LngLat[] = [
    [c.bbox.minLng, c.bbox.minLat],
    [c.bbox.minLng, c.bbox.maxLat],
    [c.bbox.maxLng, c.bbox.minLat],
    [c.bbox.maxLng, c.bbox.maxLat],
    [(c.bbox.minLng + c.bbox.maxLng) / 2, (c.bbox.minLat + c.bbox.maxLat) / 2],
  ];
  for (let i = 0; i < line.length - 1; i++) for (const q of corners) best = Math.min(best, pointToSegment(q, line[i], line[i + 1]).distance);
  return best;
}

/** Cells within `bufferM` of any of the lines. */
export function cellsAlong(lines: LngLat[][], bufferM: number, z = CELL_ZOOM): CellRef[] {
  const out = new Map<string, CellRef>();
  for (const line of lines) {
    if (!line.length) continue;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const [lng, lat] of line) {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
    const dLat = bufferM / 111_320;
    const dLng = bufferM / (111_320 * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180));
    const simple = simplify(line, 20);
    for (const c of cellsInBox({ minLng: minLng - dLng, maxLng: maxLng + dLng, minLat: minLat - dLat, maxLat: maxLat + dLat }, z)) {
      if (!out.has(c.key) && cellToLine(c, simple) <= bufferM) out.set(c.key, c);
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const BUILDING_EXCLUDE =
  "industrial|warehouse|factory|manufacture|garage|garages|shed|roof|ruins|construction|storage_tank|silo|hangar|transformer_tower|carport";
const FOOTFALL =
  "restaurant|cafe|fast_food|food_court|bar|pub|ice_cream|pharmacy|bank|atm|fuel|marketplace|cinema|theatre|clinic|doctors|place_of_worship|bus_station|police|hospital|taxi";

function bboxParam(b: BBox) {
  return `${b.minLat.toFixed(6)},${b.minLng.toFixed(6)},${b.maxLat.toFixed(6)},${b.maxLng.toFixed(6)}`;
}

/** Everything the safety model reads, for one cell. */
export function buildCellQuery(b: BBox): string {
  // A modest timeout and memory reservation: Overpass admits smaller requests sooner when it is busy.
  return `[out:json][timeout:40][maxsize:134217728][bbox:${bboxParam(b)}];
way[highway];
out tags geom qt;
(
  node[highway=street_lamp];
  node[man_made=surveillance];
  nwr[shop];
  nwr[amenity~"^(${FOOTFALL})$"];
  nwr[highway=bus_stop];
  nwr[public_transport~"^(platform|station)$"];
  nwr[railway~"^(station|halt|subway_entrance|tram_stop)$"];
  node[place~"^(suburb|neighbourhood|quarter|locality|village|hamlet|town|city_block|isolated_dwelling)$"][name];
);
out tags center qt;
(
  way[landuse~"^(industrial|cemetery|brownfield|construction|quarry|railway|military|landfill)$"];
  way[leisure~"^(park|nature_reserve)$"];
  way[natural~"^(wood|scrub|wetland|heath)$"];
  way[amenity=grave_yard];
  rel[type=multipolygon][landuse~"^(industrial|cemetery|military|railway|construction)$"];
  rel[type=multipolygon][leisure=park];
);
out tags geom qt;
way[building][building!~"^(${BUILDING_EXCLUDE})$"];
out ids bb qt;`;
}

/** Places of help only, for a larger cell. */
export function buildHelpCellQuery(b: BBox): string {
  return `[out:json][timeout:40][bbox:${bboxParam(b)}];
(
  nwr[amenity~"^(police|hospital|clinic|pharmacy|fuel)$"];
);
out tags center qt;`;
}

// ---------------------------------------------------------------------------
// Compact storage: integer coordinates relative to the cell, shared tag sets, gzip
// ---------------------------------------------------------------------------

interface Packed {
  v: 1;
  o: [number, number];
  t: Record<string, string>[];
  r: [string, number, number[]][];
  p: Poi[];
  a: [string, Area["kind"], number[]][];
  b: number[];
  n: Place[];
}

const E7 = 1e7;
const E5 = 1e5;

function packLine(o: [number, number], line: LngLat[]): number[] {
  const out: number[] = [];
  let px = Math.round((line[0][0] - o[0]) * E7);
  let py = Math.round((line[0][1] - o[1]) * E7);
  out.push(px, py);
  for (let i = 1; i < line.length; i++) {
    const x = Math.round((line[i][0] - o[0]) * E7);
    const y = Math.round((line[i][1] - o[1]) * E7);
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out;
}

function unpackLine(o: [number, number], d: number[]): LngLat[] {
  const out: LngLat[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < d.length; i += 2) {
    x = i === 0 ? d[0] : x + d[i];
    y = i === 0 ? d[1] : y + d[i + 1];
    out.push([o[0] + x / E7, o[1] + y / E7]);
  }
  return out;
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function packFeatures(f: OsmFeatures, origin: [number, number]): string {
  const tagIndex = new Map<string, number>();
  const tags: Record<string, string>[] = [];
  const tagId = (t: Record<string, string>) => {
    const k = JSON.stringify(Object.entries(t).sort());
    let i = tagIndex.get(k);
    if (i == null) {
      i = tags.length;
      tags.push(t);
      tagIndex.set(k, i);
    }
    return i;
  };
  const packed: Packed = {
    v: 1,
    o: origin,
    t: tags,
    r: f.roads.map((r) => [r.id, tagId(r.tags), packLine(origin, r.geometry)]),
    p: f.pois.map((p) => ({ ...p, point: [round6(p.point[0]), round6(p.point[1])] })),
    // Land-use outlines only need to answer "is this point inside": 5 m detail is plenty.
    a: f.areas.map((a) => [a.id, a.kind, packLine(origin, simplify(a.ring, 5))]),
    b: (f.buildings ?? []).flatMap((b) => [
      Math.round((b.minLng - origin[0]) * E5),
      Math.round((b.minLat - origin[1]) * E5),
      Math.max(1, Math.round((b.maxLng - b.minLng) * E5)),
      Math.max(1, Math.round((b.maxLat - b.minLat) * E5)),
    ]),
    n: f.places ?? [],
  };
  return gzipSync(JSON.stringify(packed)).toString("base64");
}

export function unpackFeatures(data: string): OsmFeatures {
  const p = JSON.parse(gunzipSync(Buffer.from(data, "base64")).toString("utf8")) as Packed;
  const o = p.o;
  const buildings: BBox[] = [];
  for (let i = 0; i < p.b.length; i += 4) {
    const minLng = o[0] + p.b[i] / E5;
    const minLat = o[1] + p.b[i + 1] / E5;
    buildings.push({ minLng, minLat, maxLng: minLng + p.b[i + 2] / E5, maxLat: minLat + p.b[i + 3] / E5 });
  }
  return {
    roads: p.r.map(([id, t, d]) => ({ id, tags: p.t[t], geometry: unpackLine(o, d) })),
    pois: p.p,
    areas: p.a.map(([id, kind, d]) => ({ id, kind, ring: unpackLine(o, d) })),
    buildings,
    places: p.n,
    source: "overpass",
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Decoded cells kept in memory; small, because a 512 MB server holds a few dozen at most comfortably. */
const memory = new Map<string, { f: OsmFeatures; fetchedAt: number }>();
const MEMORY_CELLS = 48;
const inflight = new Map<string, Promise<OsmFeatures>>();
const failedUntil = new Map<string, number>();
const retries = new Map<string, number>();
let active = 0;
const waiting: (() => void)[] = [];

export function resetCellsForTests() {
  memory.clear();
  inflight.clear();
  failedUntil.clear();
  retries.clear();
  active = 0;
  waiting.length = 0;
}

function remember(key: string, f: OsmFeatures, fetchedAt: number) {
  memory.delete(key);
  memory.set(key, { f, fetchedAt });
  while (memory.size > MEMORY_CELLS) memory.delete(memory.keys().next().value!);
}

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= FETCH_CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const storeKey = (layer: Layer, c: CellRef) => `${layer}:${c.key}`;

/** Downloads one cell from Overpass and stores it. Concurrent requests for the same cell share one download. */
function download(layer: Layer, c: CellRef): Promise<OsmFeatures> {
  const key = storeKey(layer, c);
  const running = inflight.get(key);
  if (running) return running;
  const p = slot(async () => {
    const data = await overpassRequest(layer === "full" ? buildCellQuery(c.bbox) : buildHelpCellQuery(c.bbox), 55_000);
    const f = { ...parseOverpass(data.elements), source: "overpass" as const };
    const now = Date.now();
    remember(key, f, now);
    const packed = packFeatures(f, [round6(c.bbox.minLng), round6(c.bbox.minLat)]);
    try {
      const db = await getDb();
      const row = { data: packed, bytes: packed.length, fetchedAt: new Date(now), usedAt: new Date(now) };
      await db.insert(schema.osmCells).values({ key, ...row }).onConflictDoUpdate({ target: schema.osmCells.key, set: row });
      if (Math.random() < 0.05) void evict().catch((err) => console.warn(`[cells] clean-up failed: ${(err as Error).message}`));
    } catch (err) {
      console.warn(`[cells] could not store ${key}: ${(err as Error).message}`);
    }
    return f;
  }).finally(() => inflight.delete(key));
  p.catch((err: Error) => {
    const breaker = /failed recently/.test(err.message);
    failedUntil.set(key, Date.now() + (breaker ? BREAKER_RETRY_MS - 5_000 : FAILED_RETRY_MS));
    const tries = (retries.get(key) ?? 0) + 1;
    retries.set(key, tries);
    if (breaker && tries <= 4) setTimeout(() => void download(layer, c).catch(() => {}), BREAKER_RETRY_MS * tries).unref?.();
  });
  p.then(() => retries.delete(key), () => {});
  inflight.set(key, p);
  return p;
}

async function evict() {
  const db = await getDb();
  await db.delete(schema.osmCells).where(lt(schema.osmCells.usedAt, new Date(Date.now() - CELL_UNUSED_MS)));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.osmCells);
  if (n > MAX_CELLS) {
    await db.execute(
      sql`delete from ${schema.osmCells} where ${schema.osmCells.key} in (select ${schema.osmCells.key} from ${schema.osmCells} order by ${schema.osmCells.usedAt} asc limit ${n - MAX_CELLS})`,
    );
  }
}

export interface CellLoad {
  features: OsmFeatures;
  /** Cells that came from Overpass (stored or fresh). */
  overpass: CellRef[];
  /** Cells filled from vector tiles because Overpass didn't deliver in time. */
  tiles: CellRef[];
  /** Cells with no data at all (both sources failed). */
  missing: CellRef[];
}

export function mergeFeatures(parts: OsmFeatures[]): OsmFeatures {
  const roads = new Map<string, Road>();
  const pois = new Map<string, Poi>();
  const areas = new Map<string, Area>();
  const places = new Map<string, Place>();
  const buildings = new Map<string, BBox>();
  for (const f of parts) {
    for (const r of f.roads) roads.set(r.id, r);
    for (const p of f.pois) pois.set(p.id, p);
    for (const a of f.areas) areas.set(a.id, a);
    for (const p of f.places ?? []) places.set(p.id, p);
    for (const b of f.buildings ?? []) buildings.set(`${b.minLng.toFixed(5)}:${b.minLat.toFixed(5)}:${b.maxLng.toFixed(5)}`, b);
  }
  const anyTiles = parts.some((p) => p.source === "tiles");
  const anyOverpass = parts.some((p) => p.source !== "tiles");
  return {
    roads: [...roads.values()],
    pois: [...pois.values()],
    areas: [...areas.values()],
    places: [...places.values()],
    buildings: [...buildings.values()],
    source: anyTiles && !anyOverpass ? "tiles" : "overpass",
  };
}

/**
 * Loads cells: from memory, then the database, then Overpass. Cells Overpass
 * can't deliver within `budgetMs` are filled from vector tiles for this
 * request; their downloads keep running and are stored for next time.
 */
export async function loadCells(cells: CellRef[], opts: { layer?: Layer; budgetMs?: number; tilesFallback?: boolean } = {}): Promise<CellLoad> {
  const layer = opts.layer ?? "full";
  const budgetMs = opts.budgetMs ?? 20_000;
  const now = Date.now();
  const got = new Map<string, OsmFeatures>();
  const stale: CellRef[] = [];

  for (const c of cells) {
    const hit = memory.get(storeKey(layer, c));
    if (hit) {
      got.set(c.key, hit.f);
      if (now - hit.fetchedAt > CELL_FRESH_MS) stale.push(c);
    }
  }
  const notInMemory = cells.filter((c) => !got.has(c.key));
  if (notInMemory.length) {
    try {
      const db = await getDb();
      const rows = await db
        .select()
        .from(schema.osmCells)
        .where(inArray(schema.osmCells.key, notInMemory.map((c) => storeKey(layer, c))));
      const touch: string[] = [];
      for (const row of rows) {
        const c = notInMemory.find((x) => storeKey(layer, x) === row.key)!;
        try {
          const f = unpackFeatures(row.data);
          got.set(c.key, f);
          remember(row.key, f, row.fetchedAt.getTime());
          if (now - row.fetchedAt.getTime() > CELL_FRESH_MS) stale.push(c);
          if (now - row.usedAt.getTime() > 24 * 3600_000) touch.push(row.key);
        } catch (err) {
          console.warn(`[cells] unreadable ${row.key}: ${(err as Error).message}`);
        }
      }
      if (touch.length) void db.update(schema.osmCells).set({ usedAt: new Date(now) }).where(inArray(schema.osmCells.key, touch)).catch(() => {});
    } catch (err) {
      console.warn(`[cells] database read failed: ${(err as Error).message}`);
    }
  }

  // Stale cells are still served; a fresh copy is fetched in the background.
  for (const c of stale) if ((failedUntil.get(storeKey(layer, c)) ?? 0) < now) download(layer, c).catch(() => {});

  const need = cells.filter((c) => !got.has(c.key));
  const tried = need.filter((c) => (failedUntil.get(storeKey(layer, c)) ?? 0) < now);
  if (tried.length) {
    const deadline = new Promise<void>((r) => setTimeout(r, budgetMs).unref?.());
    await Promise.race([
      Promise.allSettled(
        tried.map((c) =>
          download(layer, c).then(
            (f) => void got.set(c.key, f),
            (err) => console.warn(`[cells] ${storeKey(layer, c)}: ${(err as Error).message}`),
          ),
        ),
      ),
      deadline,
    ]);
  }

  const overpass = cells.filter((c) => got.has(c.key));
  let lacking = cells.filter((c) => !got.has(c.key));
  const parts = overpass.map((c) => got.get(c.key)!);
  let tiles: CellRef[] = [];
  if (lacking.length && layer === "full" && opts.tilesFallback !== false) {
    try {
      parts.push(await tileFeaturesWithin(lacking.map((c) => c.bbox)));
      tiles = lacking;
      lacking = [];
    } catch (err) {
      console.warn(`[cells] tile fallback failed: ${(err as Error).message}`);
    }
  }
  return { features: mergeFeatures(parts), overpass, tiles, missing: lacking };
}

/** Starts downloading cells nobody has asked for yet, e.g. the neighbourhood around an area check, one at a time. */
export async function prewarm(cells: CellRef[], layer: Layer = "full") {
  const db = await getDb();
  const have = new Set(
    (await db.select({ key: schema.osmCells.key }).from(schema.osmCells).where(inArray(schema.osmCells.key, cells.map((c) => storeKey(layer, c))))).map((r) => r.key),
  );
  for (const c of cells) {
    const key = storeKey(layer, c);
    if (have.has(key) || memory.has(key) || inflight.has(key) || (failedUntil.get(key) ?? 0) > Date.now()) continue;
    await download(layer, c).catch(() => {});
  }
}

/** How many cells are stored, and their total size. */
export async function cellStats() {
  const db = await getDb();
  const [row] = await db.select({ n: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${schema.osmCells.bytes}), 0)::bigint` }).from(schema.osmCells);
  return { cells: Number(row.n), bytes: Number(row.bytes) };
}

/** For tests: whether a cell is stored. */
export async function hasStoredCell(layer: Layer, c: CellRef) {
  const db = await getDb();
  const [row] = await db.select({ key: schema.osmCells.key }).from(schema.osmCells).where(and(eq(schema.osmCells.key, storeKey(layer, c)))).limit(1);
  return !!row;
}
