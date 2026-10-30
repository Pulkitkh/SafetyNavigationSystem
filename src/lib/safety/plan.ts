import { and, between, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { bboxOf, bearing, destinationPoint, haversine, overlapRatio, type LngLat } from "@/lib/geo";
import { linesData, type StreetData } from "@/lib/providers/street";
import { osrmRoute, type RawRoute, type RouteStep, type TravelMode } from "@/lib/providers/osrm";
import { valhallaRoute } from "@/lib/providers/valhalla";
import { weatherAt, type WeatherAt } from "@/lib/providers/weather";
import { REPORT_MAX_AGE_DAYS } from "@/lib/reports";
import { appTimezone } from "@/lib/time";
import { StreetGraph, WALK_SPEED_MPS } from "./graph";
import { safePaths } from "./safepath";
import { FeatureIndex, MIN_BUILDINGS_PER_KM, scoreRoute, StretchEvaluator, tripPeriod, type CommunityReport, type RouteSafety, type ScoringContext } from "./score";

export interface RouteComparison {
  /** Extra time and distance against the fastest route (negative: quicker). */
  extraS: number;
  extraM: number;
  /** Safety points gained over the fastest route. */
  gain: number;
  /** Problems on the fastest route that this one avoids. */
  avoids: string[];
}

export interface PlannedRoute {
  id: string;
  coordinates: LngLat[];
  distance: number;
  duration: number;
  steps: RouteStep[];
  safety: RouteSafety | null;
  tags: ("safest" | "fastest" | "recommended")[];
  /** "router": from the routing server. "safety": found by SafeNav's own search for the safest path. */
  source?: "router" | "safety";
  vsFastest?: RouteComparison;
}

export interface PlanOptions {
  /** Prefer routes without steps or rough surfaces (wheelchair, walker, stroller, elderly). */
  stepFree?: boolean;
}

export interface PlanResult {
  mode: TravelMode;
  departAt: string;
  stepFree: boolean;
  routes: PlannedRoute[];
  weather: Pick<WeatherAt, "isRaining" | "heavyRain" | "foggy" | "visibilityM" | "precipitationMm"> | null;
  dataNote?: string;
  /** Plain advice when no route is good, e.g. take a cab at this hour. */
  advice?: string;
  /** What was searched, for the "how" panel and for diagnostics. */
  searched?: { candidates: number; safetySearch: boolean; streetsScored: number; dataCells: { overpass: number; tiles: number; missing: number } };
}

/** Walking trips beyond this are better served by a ride; scoring them would also overload Overpass. */
export const MAX_WALK_M = 15_000;
/** The safest-path search covers trips up to this straight-line distance. */
export const SAFE_SEARCH_MAX_M = 6_000;
const MAX_CANDIDATES = 7;
/** Candidates that take this much longer than the fastest are not offered. */
export const MAX_DETOUR_RATIO = 1.8;
/** A safer route is recommended unless it is less than this many points safer than a quicker one. */
export const MIN_SAFETY_GAIN = 3;

/**
 * Via-points either side of the straight line, at two distances, so the
 * routing server returns genuinely different streets to compare.
 */
export function viaPoints(from: LngLat, to: LngLat): LngLat[] {
  const d = haversine(from, to);
  if (d < 400) return [];
  const mid: LngLat = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const b = bearing(from, to);
  const out: LngLat[] = [];
  for (const share of [0.15, 0.3]) {
    const offset = Math.min(Math.max(d * share, 120), 1500);
    out.push(destinationPoint(mid, (b + 90) % 360, offset), destinationPoint(mid, (b + 270) % 360, offset));
  }
  return out;
}

export function dedupeRoutes<T extends { coordinates: LngLat[] }>(routes: T[], overlapLimit = 0.85): T[] {
  const kept: T[] = [];
  for (const r of routes) {
    const duplicate = kept.some(
      (k) => overlapRatio(r.coordinates, k.coordinates) >= overlapLimit && overlapRatio(k.coordinates, r.coordinates) >= overlapLimit,
    );
    if (!duplicate) kept.push(r);
  }
  return kept;
}

async function routerCandidates(from: LngLat, to: LngLat, mode: TravelMode, opts: PlanOptions): Promise<RawRoute[]> {
  const wantStepFree = mode === "walk" && opts.stepFree && process.env.VALHALLA_URL !== "off";
  const [primaryResult, stepFreeResult, ...vias] = await Promise.allSettled([
    osrmRoute([from, to], mode, 3),
    // A wheelchair-profile route avoids steps outright; scoring alone can only penalise them.
    wantStepFree ? valhallaRoute([from, to], mode, 1, { wheelchair: true }) : Promise.resolve([]),
    ...(mode === "walk" ? viaPoints(from, to).map((v) => osrmRoute([from, v, to], mode, 0)) : []),
  ]);
  const stepFree = stepFreeResult.status === "fulfilled" ? stepFreeResult.value : [];
  if (primaryResult.status === "rejected" && !stepFree.length) throw primaryResult.reason;
  const primary = primaryResult.status === "fulfilled" ? primaryResult.value : [];
  const viaRoutes = vias.flatMap((r) => (r.status === "fulfilled" && r.value[0] ? [r.value[0]] : []));
  return [...stepFree, ...primary, ...viaRoutes];
}

export async function loadReports(routes: LngLat[][], padM = 100): Promise<CommunityReport[]> {
  const box = bboxOf(routes.flat(), padM);
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.reports)
    .where(
      and(
        between(schema.reports.lat, box.minLat, box.maxLat),
        between(schema.reports.lng, box.minLng, box.maxLng),
        eq(schema.reports.hidden, false),
        gte(schema.reports.observedAt, new Date(Date.now() - REPORT_MAX_AGE_DAYS * 86_400_000)),
      ),
    )
    .limit(2000);
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    point: [r.lng, r.lat],
    observedAt: r.observedAt,
    upvotes: r.upvotes,
    flags: r.flags,
  }));
}

/** Score used to rank: the cautious side of the route's range. Unscored or unscorable routes rank last. */
function rankValue(r: PlannedRoute) {
  if (!r.safety) return -1;
  return r.safety.confidence.level === "insufficient" ? r.safety.conservative - 100 : r.safety.conservative;
}

function compare(route: PlannedRoute, fastest: PlannedRoute): RouteComparison | undefined {
  if (route === fastest || !route.safety || !fastest.safety) return undefined;
  const mine = new Set(route.safety.weakStretches.flatMap((w) => w.reasons));
  const avoids = [...new Set(fastest.safety.weakStretches.flatMap((w) => w.reasons))].filter((r) => !mine.has(r)).slice(0, 3);
  return {
    extraS: Math.round(route.duration - fastest.duration),
    extraM: Math.round(route.distance - fastest.distance),
    gain: route.safety.conservative - fastest.safety.conservative,
    avoids,
  };
}

/**
 * Label routes and order them, safest first. The safest route is recommended
 * unless a quicker one is within a few points of it: safety comes first, but
 * a detour that buys nothing measurable isn't worth the extra time.
 */
export function rankRoutes(routes: PlannedRoute[], opts: PlanOptions = {}): PlannedRoute[] {
  if (!routes.length) return routes;
  const fastest = routes.reduce((a, b) => (b.duration < a.duration ? b : a));
  fastest.tags.push("fastest");
  let scored = routes.filter((r) => r.safety && r.safety.confidence.level !== "insufficient");
  // For step-free travel a route with steps is not usable at all, whatever its score.
  if (opts.stepFree && scored.some((r) => r.safety!.stats.steps === 0)) scored = scored.filter((r) => r.safety!.stats.steps === 0);
  if (!scored.length) {
    // Nothing can be compared reliably: don't claim any route is the safest.
    fastest.tags.push("recommended");
    return [fastest, ...routes.filter((r) => r !== fastest).sort((a, b) => rankValue(b) - rankValue(a))];
  }
  const byRank = [...scored].sort((a, b) => rankValue(b) - rankValue(a) || b.safety!.score - a.safety!.score || a.duration - b.duration);
  const safest = byRank[0];
  safest.tags.push("safest");
  // The quickest of the routes that are about as safe as the safest one.
  const nearlyAsSafe = byRank.filter((r) => rankValue(safest) - rankValue(r) < MIN_SAFETY_GAIN);
  const recommended = nearlyAsSafe.reduce((a, b) => (b.duration < a.duration ? b : a));
  recommended.tags.push("recommended");
  for (const r of routes) r.vsFastest = compare(r, fastest);
  const usable = (r: PlannedRoute) => (opts.stepFree && r.safety ? (r.safety.stats.steps === 0 ? 0 : 1) : 0);
  return [recommended, ...routes.filter((r) => r !== recommended).sort((a, b) => usable(a) - usable(b) || rankValue(b) - rankValue(a))];
}

function adviceFor(routes: PlannedRoute[]): string | undefined {
  const best = routes.find((r) => r.tags.includes("recommended"));
  const s = best?.safety;
  if (!s) return undefined;
  if (s.confidence.level === "insufficient") {
    return "There isn't enough map data here to say which route is safest. Prefer busy, lit main roads, share your journey with a contact, and consider a cab after dark.";
  }
  if (s.band === "avoid" && s.period !== "day") {
    return "Every walking route found scores low at this hour. If you can, take a cab or auto with ride monitoring on, or wait somewhere busy and lit.";
  }
  if (s.band === "avoid") return "Every walking route found has weak stretches. Share your journey with a contact and keep to the marked safer stretches where you can.";
  return undefined;
}

export async function planRoutes(from: LngLat, to: LngLat, mode: TravelMode, departAt: Date, opts: PlanOptions = {}): Promise<PlanResult> {
  const stepFree = mode === "walk" && !!opts.stepFree;
  const result = (routes: PlannedRoute[], weather: PlanResult["weather"], extra: Partial<PlanResult> = {}): PlanResult => ({
    mode,
    departAt: departAt.toISOString(),
    stepFree,
    routes,
    weather,
    ...extra,
  });
  const toPlanned = (r: RawRoute, i: number, source: PlannedRoute["source"]): PlannedRoute => ({
    id: `r${i}`,
    coordinates: r.coordinates,
    distance: Math.round(r.distance),
    duration: Math.round(r.duration),
    steps: r.steps,
    safety: null,
    tags: [],
    source,
  });

  const routed = await routerCandidates(from, to, mode, opts);
  if (!routed.length) return result([], null);

  if (mode === "ride") {
    // Rides are monitored live rather than scored for walking factors.
    const primary = routed.reduce((a, b) => (b.duration < a.duration ? b : a));
    return result(rankRoutes([toPlanned(primary, 0, "router")]), null);
  }

  const fastestRouted = routed.reduce((a, b) => (b.duration < a.duration ? b : a));
  if (fastestRouted.distance > MAX_WALK_M) {
    return result(rankRoutes([toPlanned(fastestRouted, 0, "router")]), null, {
      dataNote: "This walk is over 15 km, so safety scoring is skipped. Consider a ride with live monitoring.",
    });
  }

  const d = haversine(from, to);
  const searchSafe = d <= SAFE_SEARCH_MAX_M;
  // The area searched for a safer path: a band around the straight line, plus the routes found.
  const pad = Math.min(900, Math.max(300, d * 0.3));
  const maxSumM = Math.max(d + 2 * pad, fastestRouted.distance * 1.15);
  const lines = [...routed.map((r) => ({ line: r.coordinates, bufferM: 150 })), ...(searchSafe ? [{ line: [from, to], bufferM: pad }] : [])];

  const midTrip = new Date(departAt.getTime() + (fastestRouted.duration * 1000) / 2);
  const [dataResult, reports, weather] = await Promise.all([
    linesData(lines).then(
      (v) => ({ ok: true as const, v }),
      (err: Error) => ({ ok: false as const, err }),
    ),
    loadReports(
      lines.map((l) => l.line),
      searchSafe ? pad : 150,
    ).catch(() => []),
    weatherAt(from, midTrip),
  ]);
  const weatherOut = weather && {
    isRaining: weather.isRaining,
    heavyRain: weather.heavyRain,
    foggy: weather.foggy,
    visibilityM: weather.visibilityM,
    precipitationMm: weather.precipitationMm,
  };

  if (!dataResult.ok) {
    // Never leave someone without directions because the street-data service is busy.
    console.error(`[plan] street data unavailable: ${dataResult.err.message}`);
    const base = dedupeRoutes(routed.filter((r) => r.duration <= fastestRouted.duration * MAX_DETOUR_RATIO)).slice(0, MAX_CANDIDATES);
    return result(rankRoutes(base.map((r, i) => toPlanned(r, i, "router"))), weatherOut, {
      dataNote: "Street safety data is temporarily unavailable, so these routes are not scored. Prefer busy, lit main roads and try again in a minute.",
    });
  }
  const data: StreetData = dataResult.v;
  const index = new FeatureIndex(data.features, reports, { tileBoxes: data.tileBoxes });
  const ctx: ScoringContext = {
    departAt,
    tz: appTimezone(),
    raining: !!weather?.isRaining,
    heavyRain: !!weather?.heavyRain,
    foggy: !!weather?.foggy,
    stepFree,
  };

  // Search the street network for the safest paths.
  let found: RawRoute[] = [];
  let streetsScored = 0;
  if (searchSafe) {
    try {
      const graph = StreetGraph.build(data.features.roads, { noding: (r) => r.id.startsWith("t") });
      const roadKm = graph.edges.reduce((a, e) => a + e.len, 0) / 1000;
      const ev = new StretchEvaluator(index, ctx, tripPeriod([from, to], fastestRouted.duration, ctx), index.buildingCount >= MIN_BUILDINGS_PER_KM * roadKm);
      const out = safePaths(graph, ev, from, to, { departAt, stepFree, maxSumM });
      streetsScored = out.graph.scoredEdges;
      // Time paths at the routing server's walking pace (it allows for crossings and turns), so "fastest" compares like with like.
      const pace = fastestRouted.distance / Math.max(1, fastestRouted.duration);
      const scale = pace > 0.7 && pace < 1.8 ? WALK_SPEED_MPS / pace : 1;
      // Safest first, so that if two searches find the same streets the safer label survives.
      found = out.routes
        .sort((a, b) => b.alpha - a.alpha)
        .map(({ route }) => ({ ...route, duration: route.duration * scale, steps: route.steps.map((st) => ({ ...st, duration: Math.round(st.duration * scale) })) }));
      console.log(`[plan] safety search: ${out.graph.nodes} junctions, ${out.graph.scoredEdges}/${out.graph.edges} streets scored, ${found.length} paths, ${out.graph.ms} ms`);
    } catch (err) {
      console.error(`[plan] safety search failed: ${(err as Error).message}`);
    }
  }

  const fastestDuration = Math.min(fastestRouted.duration, ...found.map((r) => r.duration));
  const ordered: { r: RawRoute; source: PlannedRoute["source"] }[] = [
    ...routed.slice(0, 1).map((r) => ({ r, source: "router" as const })),
    ...found.map((r) => ({ r, source: "safety" as const })),
    ...routed.slice(1).map((r) => ({ r, source: "router" as const })),
  ];
  const candidates = dedupeRoutes(
    ordered.filter((c) => c.r.duration <= fastestDuration * MAX_DETOUR_RATIO).map((c) => ({ ...c, coordinates: c.r.coordinates })),
  ).slice(0, MAX_CANDIDATES);

  const base = candidates.map((c, i) => toPlanned(c.r, i, c.source));
  for (const r of base) r.safety = scoreRoute(r.coordinates, r.duration, index, ctx);

  const ranked = rankRoutes(base, { stepFree });
  const notes: string[] = [];
  if (stepFree && ranked.every((r) => (r.safety?.stats.steps ?? 0) > 0)) notes.push("Every route found uses steps somewhere. Check the marked stretches before you set off.");
  if (data.cells.missing) notes.push("Street data couldn't be loaded for part of this area, so some streets weren't considered.");
  return result(ranked, weatherOut, {
    ...(notes.length ? { dataNote: notes.join(" ") } : {}),
    ...(adviceFor(ranked) ? { advice: adviceFor(ranked) } : {}),
    searched: { candidates: base.length, safetySearch: searchSafe && found.length > 0, streetsScored, dataCells: data.cells },
  });
}
