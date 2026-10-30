import SunCalc from "suncalc";

export const DEFAULT_TZ = "Asia/Kolkata";

export function appTimezone(): string {
  return process.env.APP_TIMEZONE || DEFAULT_TZ;
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

export function wallParts(date: Date, tz: string): WallParts {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  const parts = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdays.indexOf(parts.weekday),
  };
}

/**
 * A Date whose *local* getters (getHours, getDay, …) show the wall-clock time in `tz`.
 * Libraries like opening_hours read local time, and servers usually run in UTC,
 * so an instant has to be re-expressed before evaluating "Mo-Sa 09:00-21:00".
 */
export function wallClockDate(date: Date, tz: string): Date {
  const p = wallParts(date, tz);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, date.getSeconds());
}

/**
 * Light conditions drive how much lighting, footfall and isolation matter.
 * - day: between sunrise and sunset
 * - twilight: civil twilight (sun 0–6° below the horizon)
 * - night: after dusk until 23:00 local
 * - late_night: 23:00–05:00 local while dark, when streets empty out
 */
export type LightPeriod = "day" | "twilight" | "night" | "late_night";

export function lightPeriod(date: Date, lat: number, lng: number, tz = appTimezone()): LightPeriod {
  const times = SunCalc.getTimes(date, lat, lng);
  const t = date.getTime();
  const { sunrise, sunset, dawn, dusk } = times;
  if (isValid(sunrise) && isValid(sunset) && t >= sunrise.getTime() && t <= sunset.getTime()) return "day";
  if (
    (isValid(dawn) && isValid(sunrise) && t >= dawn.getTime() && t < sunrise.getTime()) ||
    (isValid(sunset) && isValid(dusk) && t > sunset.getTime() && t <= dusk.getTime())
  ) {
    return "twilight";
  }
  const { hour } = wallParts(date, tz);
  return hour >= 23 || hour < 5 ? "late_night" : "night";
}

function isValid(d: Date) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

export function isDark(period: LightPeriod) {
  return period === "night" || period === "late_night";
}

/** The instant the wall clock in `tz` reads hour:minute, on the same local day as `base`. */
export function atLocalTime(base: Date, hour: number, minute: number, tz: string): Date {
  const p = wallParts(base, tz);
  const guess = Date.UTC(p.year, p.month - 1, p.day, hour, minute);
  const w = wallParts(new Date(guess), tz);
  const offset = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - guess;
  return new Date(guess - offset);
}
