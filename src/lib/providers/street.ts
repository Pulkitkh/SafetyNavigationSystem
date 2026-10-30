/**
 * Street data for scoring. Overpass data is kept in map cells (cells.ts): each
 * part of a city is downloaded once and shared. Cells Overpass can't deliver
 * in time are filled from OpenStreetMap vector tiles (OpenFreeMap CDN), which
 * lack street lamps, `lit`/`sidewalk` tags and opening hours, so those parts
 * are scored with more uncertainty and say so.
 */
import { bboxOf, type BBox, type LngLat } from "@/lib/geo";
import { cellsAlong, cellsInBox, CELL_ZOOM, HELP_ZOOM, loadCells, mergeFeatures, prewarm, type CellLoad } from "./cells";
import { fetchNearbyHelp as overpassHelp, type OsmFeatures, type Poi } from "./overpass";
import { fetchTileFeatures } from "./tiles";

/** How long a request waits for Overpass cells before using tiles for the rest. */
export const OVERPASS_GRACE_MS = Number(process.env.OVERPASS_GRACE_MS) || 15_000;

/** Help (police, hospitals) counts up to this far from a route. */
const HELP_RADIUS_M = 2000;

type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T>(p: Promise<T>): Promise<Result<T>> =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );

/** After Overpass misses its grace period, skip it for this long and go straight to tiles. */
export const OVERPASS_SLOW_MS = 2 * 60_000;
let overpassSlowUntil = 0;

export function resetStreetForTests() {
  overpassSlowUntil = 0;
}

export async function preferOverpass<T>(overpass: () => Promise<T>, tiles: () => Promise<T>, graceMs = OVERPASS_GRACE_MS, now = Date.now): Promise<T> {
  // Overpass was just too slow: don't keep queueing on (and loading) the overloaded servers.
  if (now() < overpassSlowUntil) {
    const t = await settle(tiles());
    if (t.ok) return t.value;
    return overpass();
  }
  const op = settle(overpass());
  const tl = settle(tiles());
  const early = await Promise.race([op, new Promise<null>((r) => setTimeout(() => r(null), graceMs))]);
  if (early?.ok) return early.value;
  if (!early) overpassSlowUntil = now() + OVERPASS_SLOW_MS;
  const t = await tl;
  if (t.ok) return t.value;
  const o = await op;
  if (o.ok) return o.value;
  throw o.error;
}

/** Street features plus where they came from, so scores can say which parts rest on lighter data. */
export interface StreetData {
  features: OsmFeatures;
  /** Areas filled from vector tiles (no lamps, lit/sidewalk tags or opening hours). */
  tileBoxes: BBox[];
  /** Areas with no street data at all. */
  missingBoxes: BBox[];
  cells: { overpass: number; tiles: number; missing: number };
}

function toStreetData(full: CellLoad, help: OsmFeatures | null): StreetData {
  const features = help ? mergeFeatures([full.features, { ...help, roads: [], areas: [], buildings: [], places: [] }]) : full.features;
  if (!full.overpass.length && full.tiles.length) features.source = "tiles";
  return {
    features,
    tileBoxes: full.tiles.map((c) => c.bbox),
    missingBoxes: full.missing.map((c) => c.bbox),
    cells: { overpass: full.overpass.length, tiles: full.tiles.length, missing: full.missing.length },
  };
}

async function withHelp(fullCells: ReturnType<typeof cellsAlong>, helpCells: ReturnType<typeof cellsAlong>, budgetMs: number): Promise<StreetData> {
  // Full cells first: they queue ahead of the help cells for the two Overpass slots.
  const fullP = loadCells(fullCells, { budgetMs });
  const helpP = loadCells(helpCells, { layer: "help", budgetMs, tilesFallback: false }).catch(() => null);
  const [full, help] = await Promise.all([fullP, helpP]);
  if (!full.overpass.length && !full.tiles.length) throw new Error("Street data unavailable");
  return toStreetData(full, help?.features ?? null);
}

/** Street data within each line's own buffer, with places of help up to 2 km away. */
export function linesData(lines: { line: LngLat[]; bufferM: number }[], budgetMs = OVERPASS_GRACE_MS): Promise<StreetData> {
  const full = new Map<string, ReturnType<typeof cellsAlong>[number]>();
  for (const { line, bufferM } of lines) for (const c of cellsAlong([line], bufferM, CELL_ZOOM)) full.set(c.key, c);
  return withHelp(
    [...full.values()],
    cellsAlong(
      lines.map((l) => l.line),
      HELP_RADIUS_M,
      HELP_ZOOM,
    ),
    budgetMs,
  );
}

/** Street data within `bufferM` of each line (routes), with places of help up to 2 km away. */
export function corridorData(lines: LngLat[][], bufferM = 150, budgetMs = OVERPASS_GRACE_MS): Promise<StreetData> {
  return withHelp(cellsAlong(lines, bufferM, CELL_ZOOM), cellsAlong(lines, HELP_RADIUS_M, HELP_ZOOM), budgetMs);
}

/** Street data for a whole box (the street network a safe path is searched in). */
export function boxData(box: BBox, budgetMs = OVERPASS_GRACE_MS): Promise<StreetData> {
  const help = cellsInBox(bboxOf([[box.minLng, box.minLat], [box.maxLng, box.maxLat]], HELP_RADIUS_M), HELP_ZOOM);
  return withHelp(cellsInBox(box, CELL_ZOOM), help, budgetMs);
}

/** Street data around one point: streets within `radiusM`, help within 2 km. */
export function pointData(point: LngLat, radiusM = 400, budgetMs = OVERPASS_GRACE_MS): Promise<StreetData> {
  return withHelp(cellsAlong([[point]], radiusM, CELL_ZOOM), cellsAlong([[point]], HELP_RADIUS_M, HELP_ZOOM), budgetMs);
}

/** Downloads the cells around a point in the background, so the next check or plan nearby is instant. */
export function prewarmAround(point: LngLat, radiusM = 1500) {
  void prewarm(cellsAlong([[point]], radiusM, CELL_ZOOM)).catch(() => {});
}

export async function routeFeatures(routes: LngLat[][]): Promise<OsmFeatures> {
  return (await corridorData(routes)).features;
}

export async function areaFeatures(point: LngLat): Promise<OsmFeatures> {
  return (await pointData(point)).features;
}

export interface NearbyHelp {
  pois: Poi[];
  source: "overpass" | "tiles";
}

const HELP_KINDS = ["police", "hospital", "pharmacy", "fuel"];

export async function nearbyHelp(point: LngLat, radiusM = 3000): Promise<NearbyHelp> {
  const cells = cellsAlong([[point]], radiusM, HELP_ZOOM);
  const help = await loadCells(cells, { layer: "help", budgetMs: 12_000, tilesFallback: false }).catch(() => null);
  if (help && help.overpass.length === cells.length) {
    return { pois: help.features.pois.filter((p) => HELP_KINDS.includes(p.kind)), source: "overpass" };
  }
  return preferOverpass(
    () => overpassHelp(point, radiusM).then((pois) => ({ pois, source: "overpass" as const })),
    () => fetchTileFeatures([point], 1200, radiusM).then((f) => ({ pois: f.pois.filter((p) => HELP_KINDS.includes(p.kind)), source: "tiles" as const })),
  );
}
