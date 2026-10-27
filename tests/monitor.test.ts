import { describe, expect, it } from "vitest";
import { destinationPoint, type LngLat } from "@/lib/geo";
import { evaluate, initialMonitorState, MONITOR_CONFIG, snooze, type Fix } from "@/lib/monitor";

const start: LngLat = [75.86, 22.72];
const dest = destinationPoint(start, 0, 2000);
const route = [start, dest];
const cfg = MONITOR_CONFIG.walk;
const T0 = 1_800_000_000_000;

const fix = (point: LngLat, at: number, accuracy = 10): Fix => ({ point, at, accuracy });

describe("journey monitor", () => {
  it("stays quiet while walking along the route on time", () => {
    const fixes = [0, 1, 2, 3].map((i) => fix(destinationPoint(start, 0, i * 80), T0 + i * 60_000));
    const r = evaluate(fixes, route, dest, T0 + 30 * 60_000, cfg, initialMonitorState(), T0 + 3 * 60_000);
    expect(r.anomaly).toBeNull();
    expect(r.arrived).toBe(false);
    expect(r.remainingM).toBeCloseTo(2000 - 240, -1);
  });

  it("flags off-route only after it persists", () => {
    const away = destinationPoint(destinationPoint(start, 0, 500), 90, 300);
    let state = initialMonitorState();
    let r = evaluate([fix(away, T0)], route, dest, T0 + 3600_000, cfg, state, T0);
    expect(r.anomaly).toBeNull();
    state = r.state;
    r = evaluate([fix(away, T0), fix(away, T0 + 50_000)], route, dest, T0 + 3600_000, cfg, state, T0 + 50_000);
    expect(r.anomaly).toBe("off_route");
  });

  it("tolerates GPS error and ignores very imprecise fixes", () => {
    const slightlyOff = destinationPoint(destinationPoint(start, 0, 500), 90, 100);
    const r = evaluate([fix(slightlyOff, T0, 40), fix(slightlyOff, T0 + 60_000, 40)], route, dest, T0 + 3600_000, cfg, { offRouteSince: T0, snoozed: {} }, T0 + 60_000);
    expect(r.anomaly).toBeNull();
    const vague = evaluate([fix(destinationPoint(start, 90, 2000), T0, 900)], route, dest, T0, cfg, initialMonitorState(), T0 + 3600_000);
    expect(vague.anomaly).toBeNull();
  });

  it("detects a long stop away from the destination", () => {
    const here = destinationPoint(start, 0, 700);
    const fixes = [0, 2, 4, 6, 7].map((m) => fix(destinationPoint(here, m * 45, 5), T0 + m * 60_000));
    const r = evaluate(fixes, route, dest, T0 + 3600_000, cfg, initialMonitorState(), T0 + 7 * 60_000);
    expect(r.anomaly).toBe("stopped");
  });

  it("asks when overdue and respects snoozing", () => {
    const here = destinationPoint(start, 0, 1500);
    const now = T0 + 40 * 60_000;
    const fixes = [fix(destinationPoint(start, 0, 1400), now - 60_000), fix(here, now)];
    const r = evaluate(fixes, route, dest, T0 + 25 * 60_000, cfg, initialMonitorState(), now);
    expect(r.anomaly).toBe("overdue");
    const snoozed = snooze(r.state, "overdue", now);
    expect(evaluate(fixes, route, dest, T0 + 25 * 60_000, cfg, snoozed, now + 60_000).anomaly).toBeNull();
    expect(evaluate(fixes, route, dest, T0 + 25 * 60_000, cfg, snoozed, now + 11 * 60_000).anomaly).toBe("overdue");
  });

  it("recognises arrival", () => {
    const r = evaluate([fix(destinationPoint(dest, 180, 30), T0)], route, dest, T0, cfg, initialMonitorState(), T0);
    expect(r.arrived).toBe(true);
  });

  it("uses looser thresholds for rides", () => {
    const detour = destinationPoint(destinationPoint(start, 0, 1000), 90, 300);
    const fixes = [fix(detour, T0), fix(detour, T0 + 100_000)];
    const walk = evaluate(fixes, route, dest, T0 + 3600_000, MONITOR_CONFIG.walk, { offRouteSince: T0, snoozed: {} }, T0 + 100_000);
    const ride = evaluate(fixes, route, dest, T0 + 3600_000, MONITOR_CONFIG.ride, { offRouteSince: T0, snoozed: {} }, T0 + 100_000);
    expect(walk.anomaly).toBe("off_route");
    expect(ride.anomaly).toBeNull();
  });
});
