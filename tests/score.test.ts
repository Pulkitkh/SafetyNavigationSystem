import { describe, expect, it } from "vitest";
import { destinationPoint, resample, type LngLat } from "@/lib/geo";
import type { OsmFeatures, Poi } from "@/lib/providers/overpass";
import {
  activityScore,
  communityScore,
  coordinatesBetween,
  defaultOpenProbability,
  FeatureIndex,
  findWeakStretches,
  frontageScore,
  helpScore,
  lightingScore,
  openProbability,
  reportWeight,
  scoreRoute,
  walkpathScore,
  WEIGHTS,
  type CommunityReport,
  type ScoredSegment,
} from "@/lib/safety/score";

const TZ = "Asia/Kolkata";
const NIGHT = new Date("2026-10-26T21:30:00+05:30");
const DAY = new Date("2026-10-26T11:00:00+05:30");

describe("factor functions", () => {
  it("uses mapped lighting before priors", () => {
    expect(lightingScore({ highway: "residential", lit: "yes" }, 0)).toEqual({ score: 100, known: true });
    expect(lightingScore({ highway: "primary", lit: "no" }, 0)).toEqual({ score: 10, known: true });
    expect(lightingScore({ highway: "residential" }, 2)).toEqual({ score: 90, known: true });
    expect(lightingScore({ highway: "primary" }, 0)).toEqual({ score: 70, known: false });
    expect(lightingScore({ highway: "track" }, 0).score).toBeLessThan(20);
  });

  it("penalises busy roads without footpaths and dark underpasses", () => {
    expect(walkpathScore({ highway: "primary", sidewalk: "both" }, false).score).toBe(85);
    expect(walkpathScore({ highway: "primary", sidewalk: "no" }, false).score).toBe(25);
    expect(walkpathScore({ highway: "footway", tunnel: "yes" }, true)).toMatchObject({ score: 30, reason: "Pedestrian underpass" });
    expect(walkpathScore({ highway: "pedestrian" }, true).score).toBe(90);
  });

  it("maps activity, help and community inputs onto 0–100", () => {
    expect(activityScore(0)).toBe(0);
    expect(activityScore(4)).toBeGreaterThan(80);
    expect(helpScore(200, null, 0)).toBe(100);
    expect(helpScore(null, null, 0)).toBe(26);
    expect(communityScore(0)).toBe(80);
    expect(communityScore(3)).toBeLessThan(15);
    expect(communityScore(-1)).toBeGreaterThan(80);
  });

  it("weights sum to 1 in every light period and lighting is ignored by day", () => {
    for (const w of Object.values(WEIGHTS)) {
      expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
    expect(WEIGHTS.day.lighting).toBe(0);
  });

  it("assumes typical Indian trading hours when opening hours are missing", () => {
    expect(defaultOpenProbability("shop", 11)).toBeGreaterThan(0.5);
    expect(defaultOpenProbability("shop", 23)).toBeLessThan(0.1);
    expect(defaultOpenProbability("hospital", 3)).toBe(1);
    expect(defaultOpenProbability("police", 2)).toBe(1);
    // Early morning is not the middle of the night.
    expect(defaultOpenProbability("food", 7)).toBeGreaterThan(0.3);
    expect(defaultOpenProbability("shop", 8)).toBeGreaterThan(defaultOpenProbability("shop", 3));
    expect(defaultOpenProbability("food", 4)).toBeLessThan(0.1);
    // Transit stops bring people only while services run.
    expect(defaultOpenProbability("transit", 9)).toBe(1);
    expect(defaultOpenProbability("transit", 1)).toBeLessThan(0.2);
  });

  it("evaluates OSM opening_hours in local time", () => {
    const index = new FeatureIndex({ roads: [], pois: [], areas: [] }, []);
    const poi: Poi = { id: "n1", kind: "shop", point: [75.85, 22.71], openingHours: "Mo-Sa 09:00-21:00" };
    expect(openProbability(index, poi, DAY, TZ)).toEqual({ p: 1, known: true });
    expect(openProbability(index, poi, NIGHT, TZ)).toEqual({ p: 0, known: true });
    const broken: Poi = { ...poi, id: "n2", openingHours: "whenever" };
    expect(openProbability(index, broken, DAY, TZ).known).toBe(false);
  });

  it("decays old reports, ignores flagged ones and applies dark-only categories at night", () => {
    const base: CommunityReport = { id: "r", category: "harassment", point: [0, 0], observedAt: new Date("2026-10-20T21:00:00+05:30"), upvotes: 0, flags: 0 };
    const fresh = reportWeight(base, NIGHT, "night", TZ);
    const old = reportWeight({ ...base, observedAt: new Date("2026-04-20T21:00:00+05:30") }, NIGHT, "night", TZ);
    expect(fresh).toBeGreaterThan(old);
    expect(reportWeight({ ...base, flags: 4 }, NIGHT, "night", TZ)).toBe(0);
    expect(reportWeight({ ...base, category: "poor_lighting" }, DAY, "day", TZ)).toBe(0);
    expect(reportWeight({ ...base, category: "well_lit" }, NIGHT, "night", TZ)).toBeLessThan(0);
    expect(reportWeight({ ...base, upvotes: 3 }, NIGHT, "night", TZ)).toBeGreaterThan(fresh);
  });
});

describe("scoreRoute", () => {
  // Two hand-built 1 km routes: a lit main road with footpaths and open shops,
  // and an unlit track through an industrial estate.
  const start: LngLat = [75.86, 22.72];
  const main = [start, destinationPoint(start, 0, 1000)];
  const sideStart = destinationPoint(start, 90, 400);
  const side = [sideStart, destinationPoint(sideStart, 0, 1000)];

  const shops: Poi[] = resample(main, 50).map((s, i) => ({
    id: `shop${i}`,
    kind: "food",
    point: destinationPoint(s.point, 90, 15),
    openingHours: "Mo-Su 08:00-23:00",
  }));
  const ring = [
    destinationPoint(sideStart, 270, 50),
    destinationPoint(destinationPoint(sideStart, 270, 50), 0, 1000),
    destinationPoint(destinationPoint(sideStart, 90, 50), 0, 1000),
    destinationPoint(sideStart, 90, 50),
  ];
  const features: OsmFeatures = {
    roads: [
      { id: "w1", tags: { highway: "primary", lit: "yes", sidewalk: "both" }, geometry: main },
      { id: "w2", tags: { highway: "track", lit: "no" }, geometry: side },
    ],
    pois: [...shops, { id: "police", kind: "police", point: destinationPoint(start, 270, 150) }],
    areas: [{ id: "a1", kind: "industrial", ring: [...ring, ring[0]] }],
  };

  it("rates the lit, busy road far above the dark industrial track at night", () => {
    const index = new FeatureIndex(features, []);
    const good = scoreRoute(main, 750, index, { departAt: NIGHT, tz: TZ });
    const bad = scoreRoute(side, 750, index, { departAt: NIGHT, tz: TZ });
    expect(good.period).toBe("night");
    expect(good.score).toBeGreaterThan(75);
    expect(bad.score).toBeLessThan(40);
    expect(bad.band).toBe("avoid");
    expect(bad.weakStretches.length).toBeGreaterThan(0);
    expect(bad.weakStretches[0].reasons.join(" ")).toMatch(/lit|industrial|track/i);
    expect(good.stats.litShare).toBe(1);
    expect(good.confidence.level).toBe("high");
  });

  it("community reports pull a segment down", () => {
    const report: CommunityReport = {
      id: "rep1",
      category: "harassment",
      point: destinationPoint(start, 0, 500),
      observedAt: new Date("2026-10-24T21:00:00+05:30"),
      upvotes: 2,
      flags: 0,
    };
    const clean = scoreRoute(main, 750, new FeatureIndex(features, []), { departAt: NIGHT, tz: TZ });
    const reported = scoreRoute(main, 750, new FeatureIndex(features, [report]), { departAt: NIGHT, tz: TZ });
    expect(reported.score).toBeLessThan(clean.score);
    expect(reported.stats.reportsNearby).toBe(1);
    const hit = reported.segments.find((s) => s.reasons.some((r) => r.includes("harassment")));
    expect(hit).toBeDefined();
  });

  it("does not count lighting during the day", () => {
    const index = new FeatureIndex(features, []);
    const day = scoreRoute(side, 750, index, { departAt: DAY, tz: TZ });
    const night = scoreRoute(side, 750, index, { departAt: NIGHT, tz: TZ });
    expect(day.period).toBe("day");
    expect(day.score).toBeGreaterThan(night.score);
  });
});

describe("conditions and accessibility", () => {
  it("floods underpasses in heavy rain and marks back lanes at night", () => {
    expect(walkpathScore({ highway: "footway", tunnel: "yes" }, false, { heavyRain: true })).toMatchObject({ score: 20, reason: expect.stringMatching(/waterlogged/) });
    expect(walkpathScore({ highway: "service", service: "alley" }, true)).toMatchObject({ score: 40, reason: "Narrow back lane" });
    expect(walkpathScore({ highway: "service", service: "alley" }, false).score).toBe(70);
  });

  it("treats steps and rough ground as near-impassable for step-free travel", () => {
    expect(walkpathScore({ highway: "steps" }, false).score).toBe(65);
    expect(walkpathScore({ highway: "steps" }, false, { stepFree: true })).toMatchObject({ score: 5, reason: "Steps (not step-free)" });
    expect(walkpathScore({ highway: "footway", surface: "gravel" }, false, { stepFree: true }).score).toBe(30);
    expect(walkpathScore({ highway: "footway", wheelchair: "no" }, false, { stepFree: true }).score).toBe(15);
    expect(walkpathScore({ highway: "residential", wheelchair: "yes" }, false, { stepFree: true }).score).toBe(85);
  });

  const start: LngLat = [75.86, 22.72];
  const line = [start, destinationPoint(start, 0, 600)];

  it("lowers lighting in fog after dark", () => {
    const index = new FeatureIndex({ roads: [{ id: "w", tags: { highway: "residential", lit: "yes" }, geometry: line }], pois: [], areas: [] }, []);
    const clear = scoreRoute(line, 450, index, { departAt: NIGHT, tz: TZ });
    const fog = scoreRoute(line, 450, index, { departAt: NIGHT, tz: TZ, foggy: true });
    expect(fog.factors.lighting).toBe(80);
    expect(clear.factors.lighting).toBe(100);
    expect(fog.score).toBeLessThan(clear.score);
    const dayFog = scoreRoute(line, 450, index, { departAt: DAY, tz: TZ, foggy: true });
    expect(dayFog.score).toBe(scoreRoute(line, 450, index, { departAt: DAY, tz: TZ }).score);
  });

  it("counts flights of steps and flags them for step-free users", () => {
    const mid = destinationPoint(start, 0, 300);
    const roads = [
      { id: "w1", tags: { highway: "footway" }, geometry: [start, mid] },
      { id: "s1", tags: { highway: "steps" }, geometry: [mid, destinationPoint(start, 0, 400)] },
      { id: "w2", tags: { highway: "footway" }, geometry: [destinationPoint(start, 0, 400), destinationPoint(start, 0, 600)] },
    ];
    const index = new FeatureIndex({ roads, pois: [], areas: [] }, []);
    const normal = scoreRoute(line, 450, index, { departAt: DAY, tz: TZ });
    const stepFree = scoreRoute(line, 450, index, { departAt: DAY, tz: TZ, stepFree: true });
    expect(normal.stats.steps).toBe(1);
    expect(stepFree.score).toBeLessThan(normal.score);
    expect(stepFree.segments.some((s) => s.reasons.includes("Steps (not step-free)"))).toBe(true);
  });
});

describe("eyes on the street", () => {
  const start: LngLat = [75.86, 22.72];
  const line = [start, destinationPoint(start, 0, 500)];
  const road = { id: "w", tags: { highway: "residential", lit: "yes" }, geometry: line };

  it("maps the share of street with buildings alongside onto 0–100", () => {
    expect(frontageScore(0)).toBe(15);
    expect(frontageScore(0.5)).toBe(58);
    expect(frontageScore(1)).toBe(100);
  });

  it("counts one large block along a street like a row of houses", () => {
    // A single 400 m-long block 15 m from the street (a colonnade, a mall).
    const sw = destinationPoint(line[0], 90, 15);
    const ne = destinationPoint(destinationPoint(line[0], 0, 400), 90, 60);
    const block = { minLng: sw[0], minLat: sw[1], maxLng: ne[0], maxLat: ne[1] };
    const filler = resample(line, 100).map((s) => {
      const c = destinationPoint(s.point, 270, 300);
      return { minLng: c[0], minLat: c[1], maxLng: c[0] + 0.0001, maxLat: c[1] + 0.0001 };
    });
    const r = scoreRoute(line, 360, new FeatureIndex({ roads: [road], pois: [], areas: [], buildings: [block, ...filler] }, []), { departAt: NIGHT, tz: TZ });
    expect(r.factors.frontage).toBeGreaterThan(75);
  });

  it("scores a street lined with homes above blank walls, and treats unmapped buildings as unknown", () => {
    // 8 m houses every 10 m on both sides, 12 m from the centreline.
    const box = (c: LngLat) => {
      const sw = destinationPoint(destinationPoint(c, 180, 4), 270, 4);
      const ne = destinationPoint(destinationPoint(c, 0, 4), 90, 4);
      return { minLng: sw[0], minLat: sw[1], maxLng: ne[0], maxLat: ne[1] };
    };
    const houses = resample(line, 10).flatMap((s) => [box(destinationPoint(s.point, 90, 12)), box(destinationPoint(s.point, 270, 12))]);
    const lined = scoreRoute(line, 360, new FeatureIndex({ roads: [road], pois: [], areas: [], buildings: houses }, []), { departAt: NIGHT, tz: TZ });
    // A few buildings exist in the area, but none face this street.
    const far = resample(line, 100).map((s) => box(destinationPoint(s.point, 90, 120)));
    const blank = scoreRoute(line, 360, new FeatureIndex({ roads: [road], pois: [], areas: [], buildings: [...far, ...houses.slice(0, 6)] }, []), {
      departAt: NIGHT,
      tz: TZ,
    });
    const unmapped = scoreRoute(line, 360, new FeatureIndex({ roads: [road], pois: [], areas: [] }, []), { departAt: NIGHT, tz: TZ });
    expect(lined.factors.frontage).toBeGreaterThan(90);
    expect(lined.highlights.join(" ")).toMatch(/Homes and shops/);
    expect(blank.factors.frontage).toBeLessThan(40);
    expect(unmapped.factors.frontage).toBe(50);
    expect(unmapped.confidence.notes.join(" ")).toMatch(/Buildings are barely mapped/);
    expect(lined.score).toBeGreaterThan(unmapped.score);
  });

  it("penalises fast multi-lane roads without a footpath", () => {
    expect(walkpathScore({ highway: "primary", sidewalk: "no", lanes: "6" }, false)).toMatchObject({ score: 15, reason: "Fast, wide road without a footpath" });
    expect(walkpathScore({ highway: "primary", maxspeed: "70" }, false).score).toBe(40);
    expect(walkpathScore({ highway: "primary", sidewalk: "both", lanes: "6" }, false).score).toBe(85);
  });
});

describe("helpers", () => {
  it("merges consecutive weak segments into stretches", () => {
    const seg = (from: number, score: number, reasons: string[] = []): ScoredSegment => ({
      from,
      to: from + 100,
      coordinates: [
        [0, 0],
        [0, 0.001],
      ],
      score,
      factors: { lighting: 0, activity: 0, frontage: 0, walkpath: 0, isolation: 0, help: 0, transit: 0, community: 0 },
      reasons,
    });
    const stretches = findWeakStretches([seg(0, 80), seg(100, 30, ["Poorly lit stretch"]), seg(200, 40, ["Poorly lit stretch"]), seg(300, 90)]);
    expect(stretches).toHaveLength(1);
    expect(stretches[0]).toMatchObject({ from: 100, to: 300, length: 200, score: 35, reasons: ["Poorly lit stretch"] });
  });

  it("cuts a sub-line by distance", () => {
    const line: LngLat[] = [[75.86, 22.72], destinationPoint([75.86, 22.72], 0, 1000)];
    const part = coordinatesBetween(line, 200, 400);
    expect(part).toHaveLength(2);
  });
});

describe("honest about missing data", () => {
  const start: LngLat = [75.86, 22.72];
  const line = [start, destinationPoint(start, 0, 600)];

  it("gives a range that widens where lighting isn't mapped, and ranks on its cautious side", () => {
    const mapped = new FeatureIndex({ roads: [{ id: "w", tags: { highway: "residential", lit: "yes" }, geometry: line }], pois: [], areas: [] }, []);
    const unmapped = new FeatureIndex({ roads: [{ id: "w", tags: { highway: "residential" }, geometry: line }], pois: [], areas: [] }, []);
    const a = scoreRoute(line, 450, mapped, { departAt: NIGHT, tz: TZ });
    const b = scoreRoute(line, 450, unmapped, { departAt: NIGHT, tz: TZ });
    expect(b.range.hi - b.range.lo).toBeGreaterThan(a.range.hi - a.range.lo + 8);
    expect(b.range.lo).toBeLessThan(b.score);
    expect(b.conservative).toBeLessThan(b.score);
    expect(b.confidence.notes.join(" ")).toMatch(/lighting is estimated/);
  });

  it("withholds a score when the route isn't on mapped streets", () => {
    const elsewhere = destinationPoint(start, 90, 500);
    const index = new FeatureIndex({ roads: [{ id: "w", tags: { highway: "residential", lit: "yes" }, geometry: [elsewhere, destinationPoint(elsewhere, 0, 600)] }], pois: [], areas: [] }, []);
    const r = scoreRoute(line, 450, index, { departAt: NIGHT, tz: TZ });
    expect(r.confidence.level).toBe("insufficient");
    expect(r.stats.matchedShare).toBe(0);
    expect(r.confidence.notes[0]).toMatch(/Too little of this route is on mapped streets/);
  });

  it("flags foot overbridges and stairways after dark", () => {
    expect(walkpathScore({ highway: "footway", bridge: "yes" }, true)).toMatchObject({ score: 45, reason: expect.stringMatching(/overbridge/) });
    expect(walkpathScore({ highway: "footway", bridge: "yes" }, false).score).toBe(75);
    expect(walkpathScore({ highway: "steps" }, true).score).toBe(50);
  });
});
