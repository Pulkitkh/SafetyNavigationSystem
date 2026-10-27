import { describe, expect, it } from "vitest";
import { lightPeriod, wallClockDate, wallParts } from "@/lib/time";

const TZ = "Asia/Kolkata";
const INDORE = { lat: 22.7196, lng: 75.8577 };

describe("time", () => {
  it("expresses an instant as Indian wall-clock time regardless of server timezone", () => {
    const instant = new Date("2026-10-26T04:30:00Z"); // 10:00 IST
    expect(wallParts(instant, TZ)).toMatchObject({ hour: 10, minute: 0, weekday: 1 });
    const local = wallClockDate(instant, TZ);
    expect(local.getHours()).toBe(10);
    expect(local.getDay()).toBe(1);
  });

  it("classifies light periods from the real sun position", () => {
    const at = (iso: string) => lightPeriod(new Date(iso), INDORE.lat, INDORE.lng, TZ);
    expect(at("2026-10-26T12:00:00+05:30")).toBe("day");
    expect(at("2026-10-26T21:00:00+05:30")).toBe("night");
    expect(at("2026-10-26T23:30:00+05:30")).toBe("late_night");
    expect(at("2026-10-27T03:00:00+05:30")).toBe("late_night");
  });

  it("detects evening civil twilight", () => {
    // Sunset in Indore in late October is around 17:50 IST; civil dusk ~18:13.
    expect(lightPeriod(new Date("2026-10-26T18:00:00+05:30"), INDORE.lat, INDORE.lng, TZ)).toBe("twilight");
  });
});
