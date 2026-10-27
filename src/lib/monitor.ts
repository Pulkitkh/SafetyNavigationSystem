/**
 * Journey monitoring rules, evaluated on the device from GPS fixes.
 * They raise a check-in ("Are you OK?"); an unanswered check-in escalates to SOS.
 */
import { distanceToPolyline, haversine, type LngLat } from "./geo";

export interface Fix {
  point: LngLat;
  accuracy: number;
  at: number; // epoch ms
}

export type Anomaly = "off_route" | "stopped" | "overdue";

export interface MonitorConfig {
  /** Distance from the planned route that counts as off-route (before adding GPS accuracy). */
  offRouteM: number;
  /** Must stay off-route this long before alerting, to ride out GPS jumps. */
  offRouteForMs: number;
  /** Moving less than this over `stoppedForMs` counts as stopped. */
  stoppedRadiusM: number;
  stoppedForMs: number;
  /** Grace after the expected arrival before asking. */
  overdueGraceMs: number;
  arrivedM: number;
}

export const MONITOR_CONFIG: Record<"walk" | "ride", MonitorConfig> = {
  walk: { offRouteM: 80, offRouteForMs: 45_000, stoppedRadiusM: 30, stoppedForMs: 6 * 60_000, overdueGraceMs: 10 * 60_000, arrivedM: 60 },
  // Cabs take legitimate detours, stop at signals and in jams, so thresholds are looser.
  ride: { offRouteM: 500, offRouteForMs: 90_000, stoppedRadiusM: 80, stoppedForMs: 5 * 60_000, overdueGraceMs: 15 * 60_000, arrivedM: 150 },
};

export const ANOMALY_TEXT: Record<Anomaly, string> = {
  off_route: "You seem to have left the planned route.",
  stopped: "You haven't moved for a while.",
  overdue: "You're taking longer than expected to arrive.",
};

/** Ignore fixes this imprecise for rule decisions (indoor or cell-tower positions). */
export const MAX_USABLE_ACCURACY_M = 150;

export interface MonitorState {
  offRouteSince: number | null;
  /** Anomalies the user confirmed as OK, muted until the given time. */
  snoozed: Partial<Record<Anomaly, number>>;
}

export function initialMonitorState(): MonitorState {
  return { offRouteSince: null, snoozed: {} };
}

export interface Evaluation {
  state: MonitorState;
  arrived: boolean;
  anomaly: Anomaly | null;
  distanceToRouteM: number;
  remainingM: number;
}

export function evaluate(
  fixes: Fix[],
  route: LngLat[],
  dest: LngLat,
  expectedArrival: number,
  cfg: MonitorConfig,
  prev: MonitorState,
  now = Date.now(),
): Evaluation {
  const state: MonitorState = { offRouteSince: prev.offRouteSince, snoozed: { ...prev.snoozed } };
  const usable = fixes.filter((f) => f.accuracy <= MAX_USABLE_ACCURACY_M);
  const last = usable.at(-1);
  if (!last) return { state, arrived: false, anomaly: null, distanceToRouteM: 0, remainingM: 0 };

  const toDest = haversine(last.point, dest);
  const match = distanceToPolyline(last.point, route);
  const total = routeLengthCached(route);
  const remainingM = Math.max(toDest, total - match.along);
  if (toDest <= cfg.arrivedM + Math.min(last.accuracy, 50)) {
    return { state: { ...state, offRouteSince: null }, arrived: true, anomaly: null, distanceToRouteM: match.distance, remainingM: 0 };
  }

  const isMuted = (a: Anomaly) => (state.snoozed[a] ?? 0) > now;

  // Off route: far from the line, allowing for GPS error, for long enough.
  const off = match.distance > cfg.offRouteM + Math.min(last.accuracy, 100);
  state.offRouteSince = off ? (state.offRouteSince ?? last.at) : null;
  let anomaly: Anomaly | null = null;
  if (off && now - state.offRouteSince! >= cfg.offRouteForMs && !isMuted("off_route")) anomaly = "off_route";

  // Stopped: every usable fix in the window stays within a small radius.
  if (!anomaly && !isMuted("stopped")) {
    const windowStart = now - cfg.stoppedForMs;
    const inWindow = usable.filter((f) => f.at >= windowStart);
    const coversWindow = usable.some((f) => f.at <= windowStart + 30_000);
    if (coversWindow && inWindow.length >= 3) {
      const anchor = inWindow[0].point;
      if (inWindow.every((f) => haversine(anchor, f.point) <= cfg.stoppedRadiusM + Math.min(f.accuracy, 40))) anomaly = "stopped";
    }
  }

  if (!anomaly && now > expectedArrival + cfg.overdueGraceMs && !isMuted("overdue")) anomaly = "overdue";

  return { state, arrived: false, anomaly, distanceToRouteM: match.distance, remainingM };
}

/** After the user answers "I'm OK", mute that rule for a while. */
export function snooze(state: MonitorState, anomaly: Anomaly, now = Date.now()): MonitorState {
  const ms = anomaly === "overdue" ? 10 * 60_000 : 5 * 60_000;
  return { ...state, offRouteSince: anomaly === "off_route" ? null : state.offRouteSince, snoozed: { ...state.snoozed, [anomaly]: now + ms } };
}

const lengths = new WeakMap<LngLat[], number>();
function routeLengthCached(route: LngLat[]) {
  let v = lengths.get(route);
  if (v == null) {
    v = 0;
    for (let i = 1; i < route.length; i++) v += haversine(route[i - 1], route[i]);
    lengths.set(route, v);
  }
  return v;
}

/** Seconds a check-in waits for an answer before escalating. */
export const CHECKIN_TIMEOUT_S = 60;
