import { describe, expect, it } from "vitest";
import { pickMetHour } from "@/lib/providers/weather";
import { clientIp } from "@/lib/server/http";

describe("MET Norway forecast", () => {
  const series = [
    { time: "2026-12-20T16:00:00Z", data: { instant: { details: { fog_area_fraction: 0 } }, next_1_hours: { summary: { symbol_code: "cloudy" }, details: { precipitation_amount: 0 } } } },
    { time: "2026-12-20T17:00:00Z", data: { instant: { details: { fog_area_fraction: 0 } }, next_1_hours: { summary: { symbol_code: "heavyrainandthunder" }, details: { precipitation_amount: 7.2 } } } },
    { time: "2026-12-20T18:00:00Z", data: { instant: { details: { fog_area_fraction: 92 } }, next_1_hours: { summary: { symbol_code: "fog" }, details: { precipitation_amount: 0 } } } },
    { time: "2026-12-23T00:00:00Z", data: { next_6_hours: { summary: { symbol_code: "lightrain_night" }, details: { precipitation_amount: 3.6 } } } },
  ];

  it("reads rain, heavy rain and fog for the hour of travel", () => {
    expect(pickMetHour(series, new Date("2026-12-20T16:30:00Z"))).toMatchObject({ isRaining: false, heavyRain: false, foggy: false });
    expect(pickMetHour(series, new Date("2026-12-20T17:40:00Z"))).toMatchObject({ isRaining: true, heavyRain: true, precipitationMm: 7.2 });
    expect(pickMetHour(series, new Date("2026-12-20T18:10:00Z"))).toMatchObject({ foggy: true, isRaining: false });
  });

  it("uses 6-hourly steps further ahead and gives up beyond the forecast", () => {
    expect(pickMetHour(series, new Date("2026-12-23T03:00:00Z"))).toMatchObject({ isRaining: true, heavyRain: false, precipitationMm: 0.6 });
    expect(pickMetHour(series, new Date("2026-12-24T03:00:00Z"))).toBeNull();
  });
});

describe("client address for rate limiting", () => {
  it("trusts Cloudflare's header over anything the client sends", () => {
    expect(clientIp(new Headers({ "cf-connecting-ip": "49.36.1.2", "x-forwarded-for": "203.0.113.9, 49.36.1.2" }))).toBe("49.36.1.2");
  });
  it("without a trusted header, uses the last proxy hop, not the client-supplied first one", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 49.36.1.2" }))).toBe("49.36.1.2");
    expect(clientIp(new Headers({}))).toBe("local");
  });
});
