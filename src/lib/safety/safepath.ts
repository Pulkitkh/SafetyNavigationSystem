/**
 * Safety-first path search: scores every street around a trip with the same
 * model used for routes, then finds the paths that trade the least distance
 * for the most safety (graph.ts). The results are candidates only; each is
 * scored again in full, exactly like the routing server's routes.
 */
import { haversine, resample, type LngLat } from "@/lib/geo";
import type { RawRoute } from "@/lib/providers/osrm";
import { StreetGraph, toRawRoute, WALK_SPEED_MPS } from "./graph";
import type { StretchEvaluator } from "./score";

/** Safety weights to search with: 0 is the shortest path; larger values detour further for safety. */
export const ALPHAS = [0, 1.5, 4, 10];

/**
 * Extra cost per metre for a stretch scoring `s`. Nothing above 80; rising
 * steeply below, with a step for stretches the app would call weak (< 45),
 * because the route score is pulled down by its weakest tenth.
 */
export function riskTerm(s: number): number {
  const r = Math.max(0, 80 - s) / 80;
  return r * r + (s < 45 ? 0.35 : 0);
}

const PIECE_M = 100;

export interface SafePathOptions {
  departAt: Date;
  stepFree?: boolean;
  /** Paths through points farther than this (from + to) aren't searched. */
  maxSumM: number;
  alphas?: number[];
}

export interface SafePathResult {
  routes: { route: RawRoute; alpha: number }[];
  graph: { nodes: number; edges: number; scoredEdges: number; ms: number };
}

/** Rates every edge near the trip, then finds a path for each safety weight. */
export function safePaths(graph: StreetGraph, ev: StretchEvaluator, from: LngLat, to: LngLat, opts: SafePathOptions): SafePathResult {
  const t0 = Date.now();
  let scored = 0;
  for (const e of graph.edges) {
    const mid = e.geom[Math.floor(e.geom.length / 2)];
    if (haversine(from, mid) + haversine(mid, to) > opts.maxSumM + 2 * e.len) {
      e.risk = e.len; // never expanded; any value works
      continue;
    }
    scored++;
    // Score the edge in pieces of up to 100 m, at the time the walker would get there.
    const samples = resample(e.geom, 20);
    const when = new Date(opts.departAt.getTime() + (haversine(from, mid) / WALK_SPEED_MPS) * 1000);
    let risk = 0;
    for (let start = 0; start < samples.length; ) {
      let end = start + 1;
      while (end < samples.length && samples[end].at - samples[start].at < PIECE_M) end++;
      const group = samples.slice(start, end);
      const len = Math.max(1, (end < samples.length ? samples[end].at : samples[samples.length - 1].at) - group[0].at);
      const facts = group.map((s) => ev.sample(s.point, e.road));
      const r = ev.stretch(facts, len, group[Math.floor(group.length / 2)].point, when);
      // Rank on the cautious side of the range, as routes are ranked.
      risk += len * riskTerm((r.score + r.scoreLo) / 2);
      start = end;
    }
    if (opts.stepFree) {
      const t = e.road.tags;
      if (t.highway === "steps" || t.wheelchair === "no") risk += e.len * 30;
    }
    e.risk = risk;
  }

  const routes: { route: RawRoute; alpha: number }[] = [];
  for (const alpha of opts.alphas ?? ALPHAS) {
    const path = graph.route(from, to, alpha, { maxSumM: opts.maxSumM });
    if (path) routes.push({ route: toRawRoute(path), alpha });
  }
  return { routes, graph: { nodes: graph.nodes.length, edges: graph.edges.length, scoredEdges: scored, ms: Date.now() - t0 } };
}
