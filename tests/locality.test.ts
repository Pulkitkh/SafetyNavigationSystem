import { describe, expect, it } from "vitest";
import { destinationPoint, resample, type LngLat } from "@/lib/geo";
import type { OsmFeatures, Poi, Road } from "@/lib/providers/overpass";
import { blockCenters, scanLocality } from "@/lib/safety/locality";
import { FeatureIndex } from "@/lib/safety/score";
import { atLocalTime } from "@/lib/time";

const TZ = "Asia/Kolkata";
const here: LngLat = [75.86, 22.72];

describe("locality scan", () => {
  it("lays blocks on a grid within the radius", () => {
    const blocks = blockCenters(here, 1000, 250);
    expect(blocks.length).toBeGreaterThan(45);
    expect(blocks.length).toBeLessThan(65);
  });

  it("finds the time on the local wall clock", () => {
    const at = atLocalTime(new Date("2026-11-02T10:00:00Z"), 21, 30, TZ);
    expect(at.toISOString()).toBe("2026-11-02T16:00:00.000Z");
  });

  // A lit market street through the middle (west–east), a dark industrial
  // estate 600 m north, and empty unmapped ground south.
  const west = destinationPoint(here, 270, 900);
  const eastEnd = destinationPoint(here, 90, 900);
  const market: Road = { id: "m", tags: { highway: "primary", lit: "yes", sidewalk: "both", name: "Sarafa Road" }, geometry: [west, eastEnd] };
  const estateCenter = destinationPoint(here, 0, 600);
  const lanes: Road[] = [-150, 0, 150].map((dy, i) => {
    const y = destinationPoint(estateCenter, 0, dy);
    return { id: `i${i}`, tags: { highway: "service", lit: "no" }, geometry: [destinationPoint(y, 270, 300), destinationPoint(y, 90, 300)] };
  });
  const ring = [
    destinationPoint(destinationPoint(estateCenter, 270, 350), 180, 250),
    destinationPoint(destinationPoint(estateCenter, 270, 350), 0, 250),
    destinationPoint(destinationPoint(estateCenter, 90, 350), 0, 250),
    destinationPoint(destinationPoint(estateCenter, 90, 350), 180, 250),
  ];
  const shops: Poi[] = resample([west, eastEnd], 25).map((s, i) => ({ id: `s${i}`, kind: "food", point: destinationPoint(s.point, 0, 15), openingHours: "Mo-Su 09:00-22:30" }));
  const features: OsmFeatures = {
    roads: [market, ...lanes],
    pois: [...shops, { id: "p", kind: "police", point: here, name: "Sarafa Police Station" }],
    areas: [{ id: "estate", kind: "industrial", ring: [...ring, ring[0]] }],
    places: [
      { id: "pl1", name: "Sarafa", kind: "neighbourhood", point: here },
      { id: "pl2", name: "Sanwer Road Industrial Area", kind: "quarter", point: estateCenter },
    ],
  };
  const index = new FeatureIndex(features, []);

  it("points to the industrial estate as one to avoid after dark, and the market as safer", () => {
    const scan = scanLocality(here, index, { at: new Date("2026-11-02T13:00:00+05:30"), tz: TZ });
    expect(scan.place).toBe("Sarafa");
    expect(scan.avoid.length).toBeGreaterThan(0);
    expect(scan.avoid[0]).toMatchObject({ when: "after dark" });
    expect(scan.avoid[0].name).toMatch(/Industrial Area/);
    expect(scan.avoid[0].reasons.join(" ")).toMatch(/industrial/i);
    expect(scan.safer.some((s) => /Sarafa/.test(s.name))).toBe(true);
    // Unmapped ground to the south has no streets, so it isn't listed either way.
    expect(scan.blocks.every((b) => b.center[1] > destinationPoint(here, 180, 200)[1])).toBe(true);
    expect(scan.profile).toHaveLength(5);
    expect(scan.profile.find((p) => p.label === "Late night")!.score).toBeLessThan(scan.profile.find((p) => p.label === "Evening")!.score);
  });
});
