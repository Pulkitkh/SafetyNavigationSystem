import { describe, expect, it } from "vitest";
import { destinationPoint, haversine, type LngLat } from "@/lib/geo";
import type { Road } from "@/lib/providers/overpass";
import { buildSteps, StreetGraph, subLine, toRawRoute, walkable } from "@/lib/safety/graph";

const o: LngLat = [75.86, 22.72];
const east = (p: LngLat, m: number) => destinationPoint(p, 90, m);
const north = (p: LngLat, m: number) => destinationPoint(p, 0, m);

describe("street graph", () => {
  it("keeps walkable ways only", () => {
    expect(walkable({ highway: "residential" })).toBe(true);
    expect(walkable({ highway: "motorway" })).toBe(false);
    expect(walkable({ highway: "service", access: "private" })).toBe(false);
    expect(walkable({ highway: "service", access: "private", foot: "yes" })).toBe(true);
    expect(walkable({ highway: "footway", foot: "no" })).toBe(false);
  });

  it("joins ways at shared nodes and splits edges at junctions", () => {
    const mid = east(o, 200);
    const roads: Road[] = [
      { id: "w1", tags: { highway: "residential", name: "Main Street" }, geometry: [o, mid, east(o, 400)] },
      { id: "w2", tags: { highway: "residential", name: "Side Lane" }, geometry: [mid, north(mid, 200)] },
    ];
    const g = StreetGraph.build(roads);
    expect(g.edges).toHaveLength(3);
    const p = g.route(o, north(mid, 200), 0)!;
    expect(p.distance).toBeGreaterThan(395);
    expect(p.distance).toBeLessThan(405);
  });

  it("joins vector-tile ways where they cross, and T-junctions whose node was lost", () => {
    // Two straight streets crossing with no shared node, and a side street ending 2 m short of one.
    const a = { id: "t1", tags: { highway: "residential" }, geometry: [o, east(o, 400)] } as Road;
    const b = { id: "t2", tags: { highway: "residential" }, geometry: [destinationPoint(east(o, 200), 180, 200), north(east(o, 200), 200)] } as Road;
    const c = { id: "t3", tags: { highway: "residential" }, geometry: [north(east(o, 300), 2), north(east(o, 300), 150)] } as Road;
    const loose = StreetGraph.build([a, b, c]);
    expect(loose.route(o, north(east(o, 200), 200), 0, { snapM: 20 })?.distance ?? Infinity).toBeGreaterThan(1000);
    const g = StreetGraph.build([a, b, c], { noding: (r) => r.id.startsWith("t") });
    const viaCrossing = g.route(o, north(east(o, 200), 200), 0, { snapM: 20 })!;
    expect(viaCrossing.distance).toBeLessThan(420);
    const viaT = g.route(o, north(east(o, 300), 150), 0, { snapM: 20 })!;
    expect(viaT.distance).toBeLessThan(460);
  });

  it("does not join a footway to the flyover it passes under", () => {
    const flyover = { id: "t1", tags: { highway: "primary", bridge: "yes", layer: "1" }, geometry: [o, east(o, 400)] } as Road;
    const under = { id: "t2", tags: { highway: "footway" }, geometry: [destinationPoint(east(o, 200), 180, 100), north(east(o, 200), 100)] } as Road;
    const g = StreetGraph.build([flyover, under], { noding: () => true });
    expect(g.route(destinationPoint(east(o, 200), 180, 100), east(o, 390), 0, { snapM: 20 })).toBeNull();
  });

  it("trades distance for safety as alpha grows", () => {
    // Short way through a risky lane; longer way round a safe square.
    const top = north(o, 300);
    const roads: Road[] = [
      { id: "short", tags: { highway: "service", name: "Back Lane" }, geometry: [o, top] },
      { id: "s1", tags: { highway: "primary", name: "Ring Road" }, geometry: [o, east(o, 150)] },
      { id: "s2", tags: { highway: "primary", name: "Ring Road" }, geometry: [east(o, 150), east(top, 150)] },
      { id: "s3", tags: { highway: "primary", name: "Ring Road" }, geometry: [east(top, 150), top] },
    ];
    const g = StreetGraph.build(roads);
    for (const e of g.edges) e.risk = e.road.id === "short" ? e.len * 2 : 0;
    expect(g.route(o, top, 0)!.distance).toBeLessThan(310);
    expect(g.route(o, top, 4)!.distance).toBeGreaterThan(590);
  });

  it("starts and ends mid-street, on the nearest point of the nearest way", () => {
    const roads: Road[] = [{ id: "w", tags: { highway: "residential", name: "Long Road" }, geometry: [o, east(o, 1000)] }];
    const g = StreetGraph.build(roads);
    const from = north(east(o, 300), 20);
    const to = north(east(o, 700), 20);
    const p = g.route(from, to, 0)!;
    expect(p.distance).toBeGreaterThan(430);
    expect(p.distance).toBeLessThan(450);
    expect(haversine(p.coordinates[0], from)).toBeLessThan(1);
  });
});

describe("directions for found paths", () => {
  it("announces street changes with the turn direction", () => {
    const corner = east(o, 200);
    const steps = buildSteps([
      { road: { id: "a", tags: { highway: "residential", name: "MG Road" }, geometry: [] }, geom: [o, corner] },
      { road: { id: "b", tags: { highway: "residential", name: "Tilak Path" }, geometry: [] }, geom: [corner, north(corner, 150)] },
      { road: { id: "c", tags: { highway: "footway", footway: "crossing", crossing: "zebra" }, geometry: [] }, geom: [north(corner, 150), north(corner, 165)] },
      { road: { id: "d", tags: { highway: "footway" }, geometry: [] }, geom: [north(corner, 165), destinationPoint(north(corner, 165), 270, 100)] },
    ]);
    expect(steps.map((s) => s.instruction)).toEqual([
      "Head east on MG Road",
      "Turn left onto Tilak Path",
      "Cross the road at the pedestrian crossing",
      "Turn left onto the footpath",
      "You have arrived at your destination",
    ]);
    expect(steps[0].distance).toBe(200);
  });

  it("produces a route with timing at walking pace", () => {
    const roads: Road[] = [{ id: "w", tags: { highway: "residential", name: "Long Road" }, geometry: [o, east(o, 1000)] }];
    const p = StreetGraph.build(roads).route(o, east(o, 1000), 0)!;
    const r = toRawRoute(p);
    expect(r.duration).toBeGreaterThan(700);
    expect(r.duration).toBeLessThan(740);
  });

  it("cuts sub-lines in either direction", () => {
    const line = [o, east(o, 100)];
    expect(haversine(subLine(line, 20, 70)[0], east(o, 20))).toBeLessThan(0.5);
    expect(haversine(subLine(line, 70, 20)[0], east(o, 70))).toBeLessThan(0.5);
  });
});
