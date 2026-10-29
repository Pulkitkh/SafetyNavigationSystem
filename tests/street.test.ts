import { beforeEach, describe, expect, it } from "vitest";
import { preferOverpass, resetStreetForTests } from "@/lib/providers/street";
import { lngLatToTile, poiTags, roadTags, tilesAround } from "@/lib/providers/tiles";

const after = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const failAfter = (ms: number) => new Promise<never>((_, j) => setTimeout(() => j(new Error("down")), ms));

describe("street data source", () => {
  beforeEach(() => resetStreetForTests());

  it("uses Overpass when it answers within the grace period", async () => {
    expect(await preferOverpass(() => after(10, "overpass"), () => after(1, "tiles"), 200)).toBe("overpass");
  });

  it("falls back to tiles when Overpass fails or is slow, then skips Overpass for a while", async () => {
    expect(await preferOverpass(() => failAfter(5), () => after(1, "tiles"), 200)).toBe("tiles");
    let called = 0;
    const slow = () => {
      called++;
      return after(500, "overpass");
    };
    const t0 = Date.now();
    expect(await preferOverpass(slow, () => after(1, "tiles"), 50)).toBe("tiles");
    expect(Date.now() - t0).toBeLessThan(400);
    // Within the slow window Overpass isn't even asked.
    expect(await preferOverpass(slow, () => after(1, "tiles"), 50)).toBe("tiles");
    expect(called).toBe(1);
  });

  it("still uses a late Overpass answer when the tiles fail too", async () => {
    expect(await preferOverpass(() => after(80, "overpass"), () => failAfter(1), 20)).toBe("overpass");
    await expect(preferOverpass(() => failAfter(5), () => failAfter(1), 20)).rejects.toThrow("down");
  });
});

describe("vector tiles", () => {
  it("computes Web Mercator tile numbers", () => {
    expect(lngLatToTile(77.2195, 28.6315, 14)).toEqual([11706, 6831]); // Connaught Place
    expect(tilesAround([[77.2195, 28.6315]], 10)).toEqual(["11706/6831"]);
    expect(tilesAround([[77.2195, 28.6315]], 3000).length).toBeGreaterThanOrEqual(9);
  });

  it("maps OpenMapTiles classes back to OSM tags", () => {
    expect(roadTags({ class: "path", subclass: "steps" })).toEqual({ highway: "steps" });
    expect(roadTags({ class: "minor", brunnel: "tunnel" })).toEqual({ highway: "residential", tunnel: "yes" });
    expect(roadTags({ class: "service", service: "alley", surface: "unpaved" })).toEqual({ highway: "service", service: "alley", surface: "unpaved" });
    expect(roadTags({ class: "primary", ramp: 1 })).toEqual({ highway: "primary_link" });
    expect(roadTags({ class: "rail", subclass: "rail" })).toBeNull();
    expect(poiTags("police", "police")).toEqual({ amenity: "police" });
    expect(poiTags("bus", "bus_stop")).toEqual({ highway: "bus_stop" });
    expect(poiTags("clothing_store", "clothes")).toEqual({ shop: "clothes" });
    expect(poiTags("fuel", "charging_station")).toBeNull();
    expect(poiTags("toilets", "toilets")).toBeNull();
  });
});

describe("decoding a real tile", () => {
  // Rau, near Indore. © OpenStreetMap contributors (ODbL), via OpenFreeMap.
  it("turns roads, places, land use and buildings into scoring features", async () => {
    const { readFileSync } = await import("node:fs");
    const { decodeTile, mergeTiles } = await import("@/lib/providers/tiles");
    const { inBBox } = await import("@/lib/geo");
    const data = new Uint8Array(readFileSync("tests/fixtures/tile-14-11642-7133.pbf"));
    const t = decodeTile(data, 14, 11642, 7133);
    expect(t.roads.length).toBeGreaterThan(20);
    expect(t.roads.every((r) => r.geometry.length >= 2 && r.tags.highway)).toBe(true);
    // Every coordinate lands near Rau.
    const box = { minLng: 75.75, minLat: 22.58, maxLng: 75.87, maxLat: 22.69 };
    expect(t.roads.every((r) => r.geometry.every((p) => inBBox(p, box)))).toBe(true);
    const merged = mergeTiles([t, t]);
    expect(merged.source).toBe("tiles");
    expect(merged.pois.length).toBe(new Set(t.pois.map((p) => `${p.kind}:${p.name}:${p.point.join()}`)).size); // duplicates dropped
    console.log(`Rau tile: ${t.roads.length} roads, ${t.pois.length} places (${[...new Set(t.pois.map((p) => p.kind))].join(", ")}), ${t.areas.length} areas, ${t.buildings.length} buildings`);
  });
});
