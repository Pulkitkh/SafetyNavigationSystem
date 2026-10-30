import { describe, expect, it } from "vitest";
import { destinationPoint, resample, type LngLat } from "@/lib/geo";
import type { OsmFeatures, Poi } from "@/lib/providers/overpass";
import { StreetGraph } from "@/lib/safety/graph";
import { rankRoutes, type PlannedRoute } from "@/lib/safety/plan";
import { riskTerm, safePaths } from "@/lib/safety/safepath";
import { FeatureIndex, scoreRoute, StretchEvaluator, type RouteSafety } from "@/lib/safety/score";

const TZ = "Asia/Kolkata";
const NIGHT = new Date("2026-11-02T22:00:00+05:30");

describe("safety-first path search", () => {
  // From S to T: a 1 km unlit track through an industrial estate, or a lit,
  // busy main road that goes 300 m out of the way.
  const S: LngLat = [75.86, 22.72];
  const T = destinationPoint(S, 0, 1000);
  const A = destinationPoint(S, 90, 300);
  const B = destinationPoint(A, 0, 1000);
  const track = [S, T];
  const main = [S, A, B, T];
  const shops: Poi[] = resample([A, B], 40).map((s, i) => ({ id: `s${i}`, kind: "food", point: destinationPoint(s.point, 90, 15), openingHours: "Mo-Su 08:00-23:30" }));
  const ring = [destinationPoint(S, 270, 60), destinationPoint(T, 270, 60), destinationPoint(T, 90, 60), destinationPoint(S, 90, 60)];
  const features: OsmFeatures = {
    roads: [
      { id: "w-track", tags: { highway: "track", lit: "no" }, geometry: track },
      { id: "w-main", tags: { highway: "primary", lit: "yes", sidewalk: "both", name: "MG Road" }, geometry: main },
    ],
    pois: [...shops, { id: "police", kind: "police", point: destinationPoint(A, 0, 500) }],
    areas: [{ id: "estate", kind: "industrial", ring: [...ring, ring[0]] }],
  };
  const index = new FeatureIndex(features, []);
  const ctx = { departAt: NIGHT, tz: TZ };

  it("finds the detour along the lit main road, which the shortest path misses", () => {
    const graph = StreetGraph.build(features.roads);
    const ev = new StretchEvaluator(index, ctx, "night", false);
    const { routes } = safePaths(graph, ev, S, T, { departAt: NIGHT, maxSumM: 3000 });
    const shortest = routes.find((r) => r.alpha === 0)!.route;
    const safest = routes.find((r) => r.alpha === 10)!.route;
    expect(shortest.distance).toBeLessThan(1010);
    expect(safest.distance).toBeGreaterThan(1550);
    expect(safest.steps[0].instruction).toBe("Head east on MG Road");

    const sShort = scoreRoute(shortest.coordinates, shortest.duration, index, ctx);
    const sSafe = scoreRoute(safest.coordinates, safest.duration, index, ctx);
    expect(sSafe.score).toBeGreaterThan(sShort.score + 20);
    const planned = (r: typeof shortest, safety: RouteSafety, id: string): PlannedRoute => ({ id, ...r, safety, tags: [] });
    const ranked = rankRoutes([planned(shortest, sShort, "short"), planned(safest, sSafe, "safe")]);
    expect(ranked[0].id).toBe("safe");
    expect(ranked[0].tags).toEqual(expect.arrayContaining(["recommended", "safest"]));
    expect(ranked[0].vsFastest?.extraS).toBeGreaterThan(0);
    expect(ranked[0].vsFastest?.avoids.join(" ")).toMatch(/industrial|lit|track/i);
  });

  it("weights weak stretches far more than middling ones", () => {
    expect(riskTerm(85)).toBe(0);
    expect(riskTerm(60)).toBeLessThan(0.1);
    expect(riskTerm(40)).toBeGreaterThan(0.5);
  });
});

describe("ranking", () => {
  const safety = (score: number, lo: number, level: RouteSafety["confidence"]["level"] = "high"): RouteSafety =>
    ({
      score,
      band: score >= 70 ? "good" : score >= 50 ? "caution" : "avoid",
      period: "night",
      factors: {},
      weights: {},
      segments: [],
      weakStretches: [],
      highlights: [],
      confidence: { level, coverage: 1, notes: [] },
      range: { lo, hi: score + 5 },
      conservative: Math.round((score + lo) / 2),
      stats: { steps: 0 },
    }) as unknown as RouteSafety;
  const route = (id: string, duration: number, s: RouteSafety | null): PlannedRoute => ({ id, coordinates: [], distance: duration, duration, steps: [], safety: s, tags: [] });

  it("recommends the quicker route when the safer one is only marginally safer", () => {
    const ranked = rankRoutes([route("fast", 600, safety(70, 68)), route("slow", 900, safety(72, 69))]);
    expect(ranked[0].id).toBe("fast");
    expect(ranked.find((r) => r.id === "slow")!.tags).toContain("safest");
  });

  it("ranks on the cautious side of the range: a well-mapped route beats a guess", () => {
    const ranked = rankRoutes([route("guess", 600, safety(74, 50)), route("known", 700, safety(70, 68))]);
    expect(ranked[0].id).toBe("known");
  });

  it("never calls a route the safest when none can be scored reliably", () => {
    const ranked = rankRoutes([route("a", 600, safety(70, 30, "insufficient")), route("b", 700, safety(75, 35, "insufficient"))]);
    expect(ranked[0].id).toBe("a");
    expect(ranked.flatMap((r) => r.tags)).not.toContain("safest");
  });
});
