import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db";
import { resetCellsForTests } from "@/lib/providers/cells";
import { resetFailoverForTests } from "@/lib/providers/http";
import { resetStreetForTests } from "@/lib/providers/street";
import { destinationPoint, type LngLat } from "@/lib/geo";
import { planRoutes } from "@/lib/safety/plan";

// Planner integration with a simulated network: each upstream is answered by a
// handler, so failover and degradation paths run exactly as in production.

const from: LngLat = [77.2167, 28.6315];
const mid = destinationPoint(from, 180, 400);
const to = destinationPoint(from, 180, 800);
const NIGHT = new Date("2026-12-20T22:00:00+05:30");

const osrm = {
  code: "Ok",
  routes: [
    {
      distance: 800,
      duration: 600,
      geometry: { type: "LineString", coordinates: [from, mid, to] },
      legs: [
        {
          steps: [
            { distance: 800, duration: 600, name: "Janpath", mode: "walking", maneuver: { type: "depart", location: from } },
            { distance: 0, duration: 0, name: "", mode: "walking", maneuver: { type: "arrive", location: to } },
          ],
        },
      ],
    },
  ],
};

const overpass = {
  elements: [
    { type: "way", id: 1, tags: { highway: "primary", lit: "yes", sidewalk: "both" }, geometry: [from, mid, to].map(([lon, lat]) => ({ lat, lon })) },
    { type: "node", id: 2, lat: mid[1], lon: mid[0] + 0.0001, tags: { amenity: "police" } },
  ],
};

function hourly() {
  const time: string[] = [];
  const start = Date.parse("2026-12-19T00:00:00Z");
  for (let h = 0; h < 24 * 9; h++) time.push(new Date(start + h * 3600_000).toISOString().slice(0, 16));
  return { hourly: { time, precipitation: time.map(() => 0), weather_code: time.map(() => 45), visibility: time.map(() => 300) } };
}

type Handler = (url: string) => Response | Promise<Response>;
let handlers: { match: RegExp; handle: Handler }[] = [];
const calls: string[] = [];
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

beforeAll(() => {
  process.env.DATABASE_URL = ":memory:";
  process.env.OVERPASS_URL = "https://op-a.test/api/interpreter,https://op-b.test/api/interpreter";
  process.env.OSRM_FOOT_URL = "https://osrm.test/routed-foot";
  process.env.VALHALLA_URL = "https://valhalla.test";
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const h = handlers.find((x) => x.match.test(url));
    if (!h) throw new TypeError("fetch failed");
    return h.handle(url);
  });
});

beforeEach(() => {
  resetDbForTests(); // fresh in-memory cache per test
  resetFailoverForTests();
  resetStreetForTests();
  resetCellsForTests();
  calls.length = 0;
});

afterEach(() => {
  handlers = [];
});

afterAll(() => {
  vi.unstubAllGlobals();
  resetDbForTests();
  delete process.env.OVERPASS_URL;
  delete process.env.OSRM_FOOT_URL;
  delete process.env.VALHALLA_URL;
});

describe("planRoutes with live-like upstreams", () => {
  it("skips an Overpass mirror that returned a partial result and scores with the next one", async () => {
    handlers = [
      { match: /osrm\.test/, handle: () => ok(osrm) },
      { match: /op-a\.test/, handle: () => ok({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3 after 46 seconds.' }) },
      { match: /op-b\.test/, handle: () => ok(overpass) },
      { match: /open-meteo/, handle: () => ok(hourly()) },
    ];
    const plan = await planRoutes(from, to, "walk", NIGHT);
    expect(calls.some((u) => u.includes("op-a.test"))).toBe(true);
    expect(calls.some((u) => u.includes("op-b.test"))).toBe(true);
    expect(plan.routes[0].safety).not.toBeNull();
    expect(plan.routes[0].safety!.stats.litShare).toBe(1);
    // Fog was forecast for the hour of travel and dims the lit road.
    expect(plan.weather).toMatchObject({ foggy: true, visibilityM: 300 });
    expect(plan.routes[0].safety!.factors.lighting).toBe(80);
    expect(plan.dataNote).toBeUndefined();
    // The first test also pays for cold module and database setup, which is slow on a busy machine.
  }, 20_000);

  it("still returns directions, unscored and with a note, when every Overpass mirror is down", async () => {
    handlers = [
      { match: /osrm\.test/, handle: () => ok(osrm) },
      { match: /op-[ab]\.test/, handle: () => new Response("busy", { status: 504 }) },
    ];
    const plan = await planRoutes(from, to, "walk", NIGHT);
    expect(plan.routes).toHaveLength(1);
    expect(plan.routes[0].safety).toBeNull();
    expect(plan.routes[0].steps[0].instruction).toBe("Head out on Janpath");
    expect(plan.dataNote).toMatch(/temporarily unavailable/);
    expect(plan.weather).toBeNull(); // weather failing is not an error either
  });

  it("falls back to Valhalla when OSRM is down", async () => {
    handlers = [
      { match: /osrm\.test/, handle: () => new Response("down", { status: 503 }) },
      {
        match: /valhalla\.test\/route/,
        handle: () =>
          ok({
            trip: {
              status: 0,
              summary: { length: 0.8, time: 620 },
              legs: [{ shape: "", maneuvers: [{ instruction: "Walk south on Janpath.", length: 0.8, time: 620, begin_shape_index: 0 }] }],
            },
          }),
      },
      { match: /op-a\.test/, handle: () => ok(overpass) },
    ];
    const plan = await planRoutes(from, to, "ride", NIGHT);
    expect(calls.some((u) => u.includes("valhalla.test"))).toBe(true);
    expect(plan.routes[0].duration).toBe(620);
    expect(plan.routes[0].steps[0].instruction).toBe("Walk south on Janpath.");
  });
});
