import { describe, expect, it } from "vitest";
import { destinationPoint, resample, type LngLat } from "@/lib/geo";
import { describeStep } from "@/lib/providers/osrm";
import { assembleRings, buildAreaQuery, buildRouteQuery, classifyArea, classifyPoi, parseOverpass, queryLine } from "@/lib/providers/overpass";
import { dedupeRoutes, rankRoutes, viaPoints, type PlannedRoute } from "@/lib/safety/plan";
import type { RawRoute } from "@/lib/providers/osrm";

describe("OSRM step text", () => {
  it("describes common maneuvers", () => {
    expect(describeStep({ name: "MG Road", maneuver: { type: "turn", modifier: "left", location: [0, 0] } })).toBe("Turn left onto MG Road");
    expect(describeStep({ name: "", maneuver: { type: "turn", modifier: "slight right", location: [0, 0] } })).toBe("Turn slightly right");
    expect(describeStep({ name: "AB Road", maneuver: { type: "roundabout", exit: 2, location: [0, 0] } })).toBe(
      "At the roundabout, take exit 2 onto AB Road",
    );
    expect(describeStep({ name: "", maneuver: { type: "arrive", location: [0, 0] } })).toMatch(/arrived/);
  });
});

describe("Overpass", () => {
  it("classifies points of interest and land use", () => {
    expect(classifyPoi({ amenity: "police" })).toBe("police");
    expect(classifyPoi({ highway: "street_lamp" })).toBe("lamp");
    expect(classifyPoi({ shop: "supermarket" })).toBe("shop");
    expect(classifyPoi({ highway: "bus_stop" })).toBe("transit");
    expect(classifyPoi({ amenity: "bench" })).toBeNull();
    expect(classifyArea({ landuse: "industrial" })).toBe("industrial");
    expect(classifyArea({ leisure: "park" })).toBe("park");
    expect(classifyArea({ landuse: "residential" })).toBeNull();
  });

  it("parses an Overpass response into roads, places and areas", () => {
    const f = parseOverpass([
      { type: "way", id: 1, tags: { highway: "primary", lit: "yes", oneway: "yes" }, geometry: [{ lat: 1, lon: 1 }, { lat: 1.001, lon: 1 }] },
      { type: "node", id: 2, lat: 1, lon: 1, tags: { amenity: "cafe", opening_hours: "Mo-Su 08:00-22:00", name: "Chai Point" } },
      { type: "way", id: 3, center: { lat: 1, lon: 1 }, tags: { shop: "bakery" } },
      {
        type: "way",
        id: 4,
        tags: { landuse: "industrial" },
        geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 0, lon: 0 }],
      },
      { type: "node", id: 2, lat: 1, lon: 1, tags: { amenity: "cafe" } },
      { type: "way", id: 9, bounds: { minlat: 1.0002, minlon: 1.0001, maxlat: 1.0003, maxlon: 1.0002 } },
      { type: "way", id: 3, bounds: { minlat: 1.0004, minlon: 1.0004, maxlat: 1.0005, maxlon: 1.0005 } },
    ]);
    // Tagless bounds are buildings; a building that is also a shop is kept in both lists.
    expect(f.buildings).toEqual([
      { minLng: 1.0001, minLat: 1.0002, maxLng: 1.0002, maxLat: 1.0003 },
      { minLng: 1.0004, minLat: 1.0004, maxLng: 1.0005, maxLat: 1.0005 },
    ]);
    expect(f.roads).toHaveLength(1);
    expect(f.roads[0].tags).toEqual({ highway: "primary", lit: "yes" });
    expect(f.pois.map((p) => p.kind).sort()).toEqual(["food", "shop"]);
    expect(f.pois.find((p) => p.kind === "food")).toMatchObject({ name: "Chai Point", openingHours: "Mo-Su 08:00-22:00" });
    expect(f.areas).toHaveLength(1);
  });

  it("joins multipolygon relation members into rings", () => {
    const g = (pts: [number, number][]) => pts.map(([lon, lat]) => ({ lat, lon }));
    const rings = assembleRings([
      { type: "way", ref: 1, role: "outer", geometry: g([[0, 0], [1, 0], [1, 1]]) },
      // The second half is stored in the opposite direction.
      { type: "way", ref: 2, role: "outer", geometry: g([[0, 0], [0, 1], [1, 1]]) },
      { type: "way", ref: 3, role: "inner", geometry: g([[0.2, 0.2], [0.3, 0.2], [0.3, 0.3], [0.2, 0.2]]) },
      { type: "way", ref: 4, role: "outer", geometry: g([[5, 5], [6, 5], [6, 6], [5, 5]]) },
    ]);
    expect(rings).toHaveLength(2);
    expect(rings[0]).toHaveLength(5);
    const f = parseOverpass([{ type: "relation", id: 7, tags: { type: "multipolygon", landuse: "industrial" }, members: [{ type: "way", ref: 4, role: "outer", geometry: g([[5, 5], [6, 5], [6, 6], [5, 5]]) }] }]);
    expect(f.areas.map((a) => a.kind)).toEqual(["industrial"]);
  });

  it("asks for relations and excludes empty-at-night building types", () => {
    const q = buildAreaQuery([77.2, 28.6]);
    expect(q).toContain("rel(around:60");
    expect(q).toContain('building!~"^(industrial|warehouse');
    expect(buildRouteQuery([[[77.2, 28.6], [77.21, 28.61]]])).toContain("[type=multipolygon]");
  });

  it("builds a bounded query for long routes", () => {
    const start: LngLat = [75.86, 22.72];
    const wiggly = resample([start, destinationPoint(start, 0, 5000)], 10).map((s, i) => [s.point[0] + (i % 2) * 0.0003, s.point[1]] as LngLat);
    expect(queryLine(wiggly).length).toBeLessThanOrEqual(120);
    const q = buildRouteQuery([wiggly]);
    expect(q).toContain("[out:json]");
    expect(q).toContain("highway=street_lamp");
    expect(q).toContain("amenity=police");
    expect(q).toContain("[building]");
    expect(q).toContain("out ids bb qt");
  });
});

describe("route candidates", () => {
  const a: LngLat = [75.86, 22.72];
  const b = destinationPoint(a, 0, 2000);

  it("creates via-points on both sides for longer walks only", () => {
    expect(viaPoints(a, destinationPoint(a, 0, 300))).toHaveLength(0);
    expect(viaPoints(a, b)).toHaveLength(2);
  });

  it("drops near-identical routes", () => {
    const r = (coords: LngLat[]): RawRoute => ({ coordinates: coords, distance: 2000, duration: 1500, steps: [] });
    const parallel = [destinationPoint(a, 90, 500), destinationPoint(b, 90, 500)];
    expect(dedupeRoutes([r([a, b]), r([a, b]), r(parallel)])).toHaveLength(2);
  });

  it("recommends the safest route unless it is barely safer and much slower", () => {
    const mk = (id: string, duration: number, score: number): PlannedRoute => ({
      id,
      coordinates: [],
      distance: 0,
      duration,
      steps: [],
      tags: [],
      safety: { score } as PlannedRoute["safety"],
    });
    const ranked = rankRoutes([mk("fast", 600, 60), mk("safe", 700, 80)]);
    expect(ranked[0].id).toBe("safe");
    expect(ranked[0].tags).toEqual(["safest", "recommended"]);

    const close = rankRoutes([mk("fast", 600, 78), mk("slow", 900, 80)]);
    expect(close[0].id).toBe("fast");
    expect(close[0].tags).toContain("recommended");
  });

  it("never recommends a route with steps to step-free users when a step-free one exists", () => {
    const mk = (id: string, duration: number, score: number, steps: number): PlannedRoute => ({
      id,
      coordinates: [],
      distance: 0,
      duration,
      steps: [],
      tags: [],
      safety: { score, stats: { steps } } as PlannedRoute["safety"],
    });
    const ranked = rankRoutes([mk("stairs", 600, 85, 2), mk("ramp", 800, 70, 0), mk("other", 700, 60, 1)], { stepFree: true });
    // The usable route leads; the rest follow by safety.
    expect(ranked.map((r) => r.id)).toEqual(["ramp", "stairs", "other"]);
    expect(ranked[0].tags).toEqual(["safest", "recommended"]);
    // Without the preference the safest overall wins.
    expect(rankRoutes([mk("stairs", 600, 85, 2), mk("ramp", 800, 70, 0)])[0].id).toBe("stairs");
  });
});
