/**
 * Street data for scoring: Overpass when it answers quickly (richest: lamps, lit
 * and sidewalk tags, opening hours), otherwise OpenStreetMap vector tiles from
 * the OpenFreeMap CDN. The public Overpass servers are often overloaded or
 * block shared cloud IPs, so both are requested at once and nobody waits for
 * a dead server.
 */
import { resample, type LngLat } from "@/lib/geo";
import { fetchAreaFeatures as overpassArea, fetchNearbyHelp as overpassHelp, fetchRouteFeatures as overpassRoute, type OsmFeatures, type Poi } from "./overpass";
import { fetchTileFeatures } from "./tiles";

/** How long Overpass gets before the tile data is used instead. It keeps running and fills the cache for next time. */
export const OVERPASS_GRACE_MS = Number(process.env.OVERPASS_GRACE_MS) || 8000;

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

const mark = (f: OsmFeatures): OsmFeatures => ({ ...f, source: f.source ?? "overpass" });

function routePoints(routes: LngLat[][]): LngLat[] {
  return routes.flatMap((r) => resample(r, 150).map((s) => s.point));
}

export function routeFeatures(routes: LngLat[][]): Promise<OsmFeatures> {
  return preferOverpass(
    () => overpassRoute(routes).then(mark),
    () => fetchTileFeatures(routePoints(routes), 400, 1500),
  );
}

export function areaFeatures(point: LngLat): Promise<OsmFeatures> {
  return preferOverpass(
    () => overpassArea(point).then(mark),
    () => fetchTileFeatures([point], 400, 2000),
  );
}

export interface NearbyHelp {
  pois: Poi[];
  source: "overpass" | "tiles";
}

export function nearbyHelp(point: LngLat, radiusM = 3000): Promise<NearbyHelp> {
  return preferOverpass(
    () => overpassHelp(point, radiusM).then((pois) => ({ pois, source: "overpass" as const })),
    () => fetchTileFeatures([point], 1200, radiusM).then((f) => ({ pois: f.pois.filter((p) => ["police", "hospital", "pharmacy", "fuel"].includes(p.kind)), source: "tiles" as const })),
  );
}
