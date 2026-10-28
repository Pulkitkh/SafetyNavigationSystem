import { describe, expect, it } from "vitest";
import { destinationPoint, resample, type LngLat } from "@/lib/geo";
import type { Poi } from "@/lib/providers/overpass";
import { scoreArea } from "@/lib/safety/area";
import { FeatureIndex } from "@/lib/safety/score";

const TZ = "Asia/Kolkata";
const here: LngLat = [77.2195, 28.6315];
const street = [destinationPoint(here, 270, 150), destinationPoint(here, 90, 150)];

describe("area check", () => {
  const shops: Poi[] = resample(street, 15).map((s, i) => ({ id: `s${i}`, kind: "food", point: destinationPoint(s.point, 0, 15), openingHours: "Mo-Su 10:00-22:00", name: `Cafe ${i}` }));
  const police: Poi = { id: "p", kind: "police", point: destinationPoint(here, 180, 300), name: "Parliament Street Police Station" };
  const pharmacy: Poi = { id: "ph", kind: "pharmacy", point: destinationPoint(here, 0, 400), openingHours: "24/7", name: "Apollo Pharmacy" };
  const index = new FeatureIndex(
    { roads: [{ id: "w", tags: { highway: "primary", lit: "yes", sidewalk: "both" }, geometry: street }], pois: [...shops, police, pharmacy], areas: [] },
    [],
  );

  it("is good while the street is open, and lists open places and help", () => {
    const a = scoreArea(here, index, { at: new Date("2026-10-29T19:30:00+05:30"), tz: TZ });
    expect(a.score).toBeGreaterThanOrEqual(70);
    expect(a.openNearby.length).toBeGreaterThan(5);
    expect(a.openNearby[0].distance).toBeLessThanOrEqual(a.openNearby[1].distance);
    expect(a.nearestPolice).toMatchObject({ name: "Parliament Street Police Station" });
    expect(a.nearestHaven).toMatchObject({ name: "Apollo Pharmacy", openNow: true });
  });

  it("drops late at night when everything has closed", () => {
    const day = scoreArea(here, index, { at: new Date("2026-10-29T19:30:00+05:30"), tz: TZ });
    const late = scoreArea(here, index, { at: new Date("2026-10-30T01:30:00+05:30"), tz: TZ });
    expect(late.period).toBe("late_night");
    expect(late.openNearby).toHaveLength(0);
    expect(late.score).toBeLessThan(day.score);
    expect(late.reasons.join(" ")).toMatch(/Few shops or places open/);
    expect(late.nearestHaven?.name).toBe("Apollo Pharmacy"); // 24/7
  });

  it("flags an industrial estate at night", () => {
    const ring = [destinationPoint(here, 225, 500), destinationPoint(here, 315, 500), destinationPoint(here, 45, 500), destinationPoint(here, 135, 500)];
    const idx = new FeatureIndex({ roads: [{ id: "w", tags: { highway: "service" }, geometry: street }], pois: [], areas: [{ id: "a", kind: "industrial", ring: [...ring, ring[0]] }] }, []);
    const a = scoreArea(here, idx, { at: new Date("2026-10-29T22:00:00+05:30"), tz: TZ });
    expect(a.band).toBe("avoid");
    expect(a.reasons.join(" ")).toMatch(/industrial area/);
  });
});
