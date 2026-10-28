import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, resetDbForTests, schema } from "@/lib/db";
import { cached, endpoints, UpstreamError, withFailover } from "@/lib/providers/http";
import { assertCompleteOverpass } from "@/lib/providers/overpass";
import { decodePolyline, parseValhallaTrip } from "@/lib/providers/valhalla";
import { classifyWeather, pickHour } from "@/lib/providers/weather";
import { summarise } from "@/lib/providers/health";
import { createShakeDetector } from "@/lib/client/shake";

describe("endpoint failover", () => {
  it("reads comma-separated overrides and falls back to defaults", () => {
    expect(endpoints(undefined, ["https://a"])).toEqual(["https://a"]);
    expect(endpoints(" https://x/ , https://y ", ["https://a"])).toEqual(["https://x", "https://y"]);
    expect(endpoints("", ["https://a"])).toEqual(["https://a"]);
  });

  it("moves to the next mirror on 5xx, 429 and network errors", async () => {
    const tried: string[] = [];
    const out = await withFailover(["a", "b", "c"], async (base) => {
      tried.push(base);
      if (base === "a") throw new UpstreamError("busy", "x", 429);
      if (base === "b") throw new Error("socket hang up");
      return base;
    });
    expect(out).toBe("c");
    expect(tried).toEqual(["a", "b", "c"]);
  });

  it("stops on a client error, which another mirror would repeat", async () => {
    const tried: string[] = [];
    await expect(
      withFailover(["a", "b"], async (base) => {
        tried.push(base);
        throw new UpstreamError("bad request", "x", 400);
      }),
    ).rejects.toThrow("bad request");
    expect(tried).toEqual(["a"]);
  });
});

describe("cache", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = ":memory:";
    resetDbForTests();
  });
  afterAll(() => resetDbForTests());

  it("serves an expired entry when the upstream is down", async () => {
    expect(await cached("t", "k1", 1, async () => ({ v: 1 }))).toEqual({ v: 1 });
    const db = await getDb();
    await db.update(schema.apiCache).set({ expiresAt: new Date(Date.now() - 1000) });
    const stale = await cached("t", "k1", 1000, async () => {
      throw new UpstreamError("down", "x", 503);
    });
    expect(stale).toEqual({ v: 1 });
  });

  it("rethrows when there is nothing stale to serve", async () => {
    await expect(cached("t", "missing", 1000, async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
  });

  it("does not store values marked uncacheable", async () => {
    let calls = 0;
    const load = async () => ({ n: ++calls });
    await cached("t", "partial", 60_000, load, { cacheable: () => false });
    expect(await cached("t", "partial", 60_000, load, { cacheable: () => false })).toEqual({ n: 2 });
  });
});

describe("Overpass partial results", () => {
  it("rejects responses that timed out or ran out of memory", () => {
    expect(() => assertCompleteOverpass({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3 after 46 seconds.' })).toThrow(
      /timed out/,
    );
    expect(() => assertCompleteOverpass({ elements: [], remark: "runtime error: Query run out of memory using about 2048 MB of RAM." })).toThrow();
    expect(assertCompleteOverpass({ elements: [] }).elements).toEqual([]);
  });
});

describe("Valhalla fallback", () => {
  it("decodes encoded polylines", () => {
    // Reference example from Google's polyline documentation (precision 5).
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5);
    expect(pts).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it("round-trips precision-6 shapes", () => {
    const line: [number, number][] = [
      [77.209021, 28.613939],
      [77.21, 28.62],
    ];
    expect(decodePolyline(encodePolyline(line))).toEqual(line);
  });

  it("converts a trip into the planner's route shape", () => {
    const route = parseValhallaTrip({
      status: 0,
      summary: { length: 1.2, time: 900 },
      legs: [
        {
          shape: encodePolyline([
            [77.2, 28.6],
            [77.201, 28.601],
            [77.202, 28.6],
          ]),
          maneuvers: [
            { instruction: "Walk north on MG Road.", length: 0.8, time: 600, begin_shape_index: 0 },
            { instruction: "Turn left onto Station Road.", length: 0.4, time: 300, begin_shape_index: 1 },
            { instruction: "You have arrived.", length: 0, time: 0, begin_shape_index: 2 },
          ],
        },
      ],
    });
    expect(route.distance).toBe(1200);
    expect(route.duration).toBe(900);
    expect(route.steps).toHaveLength(3);
    expect(route.steps[1]).toMatchObject({ instruction: "Turn left onto Station Road.", distance: 400 });
    expect(route.coordinates).toHaveLength(3);
  });
});

describe("weather at travel time", () => {
  const data = {
    hourly: {
      time: ["2026-12-20T16:00", "2026-12-20T17:00", "2026-12-20T18:00"],
      precipitation: [0, 6, 0],
      weather_code: [3, 63, 45],
      visibility: [20000, 8000, 400],
    },
  };

  it("picks the forecast hour containing the travel time", () => {
    expect(pickHour(data, new Date("2026-12-20T17:40:00Z"))).toMatchObject({ isRaining: true, heavyRain: true, foggy: false });
    expect(pickHour(data, new Date("2026-12-20T18:05:00Z"))).toMatchObject({ foggy: true, visibilityM: 400, isRaining: false });
    expect(pickHour(data, new Date("2026-12-21T09:00:00Z"))).toBeNull();
  });

  it("classifies rain, heavy rain and fog", () => {
    expect(classifyWeather(0, 0, 30000)).toEqual({ isRaining: false, heavyRain: false, foggy: false });
    expect(classifyWeather(1, 61, null)).toMatchObject({ isRaining: true, heavyRain: false });
    expect(classifyWeather(0, 95, null).heavyRain).toBe(true);
    expect(classifyWeather(0, 0, 900).foggy).toBe(true);
  });
});

describe("health summary", () => {
  it("is healthy while any routing endpoint and any Overpass mirror answer", () => {
    const r = (service: string, ok: boolean) => ({ service, url: "", ok, ms: 1 });
    expect(summarise([r("routing (walk)", false), r("routing fallback (Valhalla)", true), r("street data (Overpass)", false), r("street data (Overpass)", true)]).ok).toBe(true);
    expect(summarise([r("routing (walk)", true), r("street data (Overpass)", false)]).ok).toBe(false);
  });
});

describe("shake detection", () => {
  it("needs several hard shakes in a short window", () => {
    const detect = createShakeDetector(18, 4, 2000);
    const shake = (t: number) => {
      const fired = detect(35, t);
      detect(9.8, t + 50);
      return fired;
    };
    // Walking and a single bump do nothing.
    for (let t = 0; t < 3000; t += 100) expect(detect(12, t)).toBe(false);
    expect(shake(4000)).toBe(false);
    expect(shake(4200)).toBe(false);
    expect(shake(4400)).toBe(false);
    expect(shake(4600)).toBe(true);
  });

  it("forgets shakes outside the window", () => {
    const detect = createShakeDetector(18, 3, 1000);
    for (const t of [0, 1200, 2400]) {
      expect(detect(35, t)).toBe(false);
      detect(9.8, t + 50);
    }
  });
});

function encodePolyline(points: [number, number][], precision = 6): string {
  const factor = 10 ** precision;
  let out = "";
  let prevLat = 0;
  let prevLng = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let chunk = "";
    while (n >= 0x20) {
      chunk += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return chunk + String.fromCharCode(n + 63);
  };
  for (const [lng, lat] of points) {
    const la = Math.round(lat * factor);
    const ln = Math.round(lng * factor);
    out += enc(la - prevLat) + enc(ln - prevLng);
    prevLat = la;
    prevLng = ln;
  }
  return out;
}
