import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db";
import { destinationPoint, haversine, type LngLat } from "@/lib/geo";
import { cellAt, cellsAlong, hasStoredCell, loadCells, packFeatures, resetCellsForTests, unpackFeatures } from "@/lib/providers/cells";
import { resetFailoverForTests } from "@/lib/providers/http";
import type { OsmFeatures } from "@/lib/providers/overpass";

const here: LngLat = [75.8577, 22.7196];

describe("cell storage format", () => {
  it("round-trips roads exactly, so shared nodes still match", () => {
    const a: LngLat = [75.8577123, 22.7196456];
    const b: LngLat = [75.8581987, 22.7199012];
    const f: OsmFeatures = {
      roads: [
        { id: "w1", tags: { highway: "residential", name: "Jawahar Marg" }, geometry: [a, b] },
        { id: "w2", tags: { highway: "residential", name: "Jawahar Marg" }, geometry: [b, [75.859, 22.72]] },
      ],
      pois: [{ id: "n1", kind: "shop", point: [75.858, 22.7197], name: "Kirana", openingHours: "Mo-Sa 09:00-21:00" }],
      areas: [{ id: "a1", kind: "park", ring: [a, b, [75.859, 22.72], a] }],
      buildings: [{ minLng: 75.8578, minLat: 22.7197, maxLng: 75.8579, maxLat: 22.7198 }],
      places: [{ id: "n9", name: "Rajwada", kind: "neighbourhood", point: [75.8571, 22.7187] }],
    };
    const c = cellAt(here);
    const back = unpackFeatures(packFeatures(f, [c.bbox.minLng, c.bbox.minLat]));
    expect(back.roads[0].geometry[1]).toEqual(back.roads[1].geometry[0]);
    expect(haversine(back.roads[0].geometry[0], a)).toBeLessThan(0.05);
    expect(back.roads[0].tags).toEqual({ highway: "residential", name: "Jawahar Marg" });
    expect(back.pois[0]).toMatchObject({ name: "Kirana", openingHours: "Mo-Sa 09:00-21:00" });
    expect(back.places).toEqual(f.places);
    expect(haversine([back.buildings![0].minLng, back.buildings![0].minLat], [75.8578, 22.7197])).toBeLessThan(2);
  });

  it("picks the cells a route passes near", () => {
    const line = [here, destinationPoint(here, 90, 3000)];
    const cells = cellsAlong([line], 100);
    expect(cells.length).toBeGreaterThanOrEqual(3);
    expect(cells.length).toBeLessThanOrEqual(8);
    expect(cells.map((c) => c.key)).toContain(cellAt(here).key);
  });
});

describe("loading cells", () => {
  let overpassCalls = 0;
  let overpassUp = true;
  beforeAll(() => {
    process.env.DATABASE_URL = ":memory:";
    process.env.OVERPASS_URL = "https://op.test/api/interpreter";
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url.includes("op.test")) {
        overpassCalls++;
        if (!overpassUp) return new Response("busy", { status: 504 });
        return new Response(
          JSON.stringify({ elements: [{ type: "way", id: 7, tags: { highway: "primary", lit: "yes" }, geometry: [{ lat: here[1], lon: here[0] }, { lat: here[1] + 0.001, lon: here[0] }] }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new TypeError("fetch failed");
    });
  });
  beforeEach(() => {
    resetDbForTests();
    resetCellsForTests();
    resetFailoverForTests();
    overpassCalls = 0;
    overpassUp = true;
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.OVERPASS_URL;
    resetDbForTests();
  });

  it("downloads a cell once, stores it, and serves it from the database afterwards", async () => {
    const c = cellAt(here);
    const first = await loadCells([c]);
    expect(first.overpass).toHaveLength(1);
    expect(first.features.roads[0].tags.lit).toBe("yes");
    expect(await hasStoredCell("full", c)).toBe(true);
    resetCellsForTests(); // as after a restart: memory gone, database kept
    const again = await loadCells([c]);
    expect(again.features.roads).toHaveLength(1);
    expect(overpassCalls).toBe(1);
  }, 20_000);

  it("reports cells it couldn't get at all, instead of pretending they're empty", async () => {
    overpassUp = false;
    const c = cellAt(destinationPoint(here, 0, 5000));
    const r = await loadCells([c], { budgetMs: 2000 });
    expect(r.overpass).toHaveLength(0);
    expect(r.missing).toHaveLength(1); // tiles are unreachable in this test too
  }, 20_000);
});
