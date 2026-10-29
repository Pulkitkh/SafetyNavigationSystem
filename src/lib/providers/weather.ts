import type { LngLat } from "@/lib/geo";
import { cached, fetchJson } from "./http";

export interface WeatherAt {
  /** Start of the forecast hour used, ISO UTC. */
  hour: string;
  precipitationMm: number;
  weatherCode: number;
  visibilityM: number | null;
  isRaining: boolean;
  /** ≥ 4 mm/h or a thunderstorm: underpasses and low roads may flood. */
  heavyRain: boolean;
  /** Visibility under 1 km or a fog weather code; common on winter nights in north India. */
  foggy: boolean;
}

interface HourlyResponse {
  hourly: { time: string[]; precipitation: number[]; weather_code: number[]; visibility?: (number | null)[] };
}

/** WMO codes 51–67 drizzle/rain, 80–82 showers, 95–99 thunderstorm; 45/48 fog. */
export function classifyWeather(precipitationMm: number, code: number, visibilityM: number | null) {
  const rainyCode = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
  return {
    isRaining: rainyCode || precipitationMm >= 0.5,
    heavyRain: precipitationMm >= 4 || code >= 95 || code === 65 || code === 82,
    foggy: code === 45 || code === 48 || (visibilityM != null && visibilityM < 1000),
  };
}

/** Pick the forecast hour containing `at` from an Open-Meteo hourly block (times in UTC). */
export function pickHour(data: HourlyResponse, at: Date): WeatherAt | null {
  const { time, precipitation, weather_code, visibility } = data.hourly;
  const target = Math.floor(at.getTime() / 3600_000) * 3600_000;
  const i = time.findIndex((t) => Date.parse(`${t}:00Z`) === target);
  if (i < 0) return null;
  const precipitationMm = precipitation[i] ?? 0;
  const weatherCode = weather_code[i] ?? 0;
  const visibilityM = visibility?.[i] ?? null;
  return { hour: time[i], precipitationMm, weatherCode, visibilityM, ...classifyWeather(precipitationMm, weatherCode, visibilityM) };
}

interface MetSeries {
  time: string;
  data: {
    instant?: { details?: { fog_area_fraction?: number } };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
    next_6_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
  };
}

/** Pick the hour containing `at` from a MET Norway Locationforecast (times in UTC). */
export function pickMetHour(timeseries: MetSeries[], at: Date): WeatherAt | null {
  const target = Math.floor(at.getTime() / 3600_000) * 3600_000;
  // Hourly steps cover the next ~2 days; later ones are 6-hourly, so take the latest step at or before the hour.
  let best: MetSeries | undefined;
  for (const t of timeseries) {
    const ms = Date.parse(t.time);
    if (ms <= target && target - ms < 6 * 3600_000) best = t;
  }
  if (!best) return null;
  const hourly = best.data.next_1_hours;
  const six = best.data.next_6_hours;
  const symbol = (hourly?.summary?.symbol_code ?? six?.summary?.symbol_code ?? "").replace(/_(day|night|polartwilight)$/, "");
  const precipitationMm = hourly?.details?.precipitation_amount ?? (six?.details?.precipitation_amount ?? 0) / 6;
  const heavy = /heavyrain|thunder/.test(symbol) || precipitationMm >= 4;
  const rain = heavy || /rain|sleet|drizzle/.test(symbol) || precipitationMm >= 0.5;
  const fog = symbol === "fog" || (best.data.instant?.details?.fog_area_fraction ?? 0) >= 50;
  return {
    hour: best.time.slice(0, 16),
    precipitationMm: Math.round(precipitationMm * 10) / 10,
    weatherCode: heavy ? 65 : rain ? 61 : fog ? 45 : 0, // closest WMO code, for display only
    visibilityM: null,
    isRaining: rain,
    heavyRain: heavy,
    foggy: fog,
  };
}

/** Weather changes little over ~11 km; rounding lets nearby users share one cached forecast. */
function round1(v: number) {
  return (Math.round(v * 10) / 10).toFixed(1);
}

async function openMeteo(point: LngLat, at: Date): Promise<WeatherAt | null> {
  const base = process.env.OPEN_METEO_URL || "https://api.open-meteo.com";
  const params = new URLSearchParams({
    latitude: round1(point[1]),
    longitude: round1(point[0]),
    hourly: "precipitation,weather_code,visibility",
    timezone: "GMT",
    past_days: "1",
    forecast_days: "8",
  });
  const url = `${base}/v1/forecast?${params}`;
  const data = await cached("meteo-hourly", url, 30 * 60_000, () => fetchJson<HourlyResponse>(url, { service: "weather", timeoutMs: 6000, retries: 0 }));
  return pickHour(data, at);
}

/**
 * MET Norway's Locationforecast (free; asks for an identifying User-Agent and
 * caching, which `fetchJson` and `cached` provide). Used when Open-Meteo refuses,
 * e.g. with 429 on shared cloud IPs.
 */
async function metNorway(point: LngLat, at: Date): Promise<WeatherAt | null> {
  const base = process.env.MET_NORWAY_URL || "https://api.met.no/weatherapi/locationforecast/2.0";
  const url = `${base}/complete?lat=${round1(point[1])}&lon=${round1(point[0])}`;
  const data = await cached("met-norway", url, 60 * 60_000, () =>
    fetchJson<{ properties: { timeseries: MetSeries[] } }>(url, { service: "weather", timeoutMs: 8000, retries: 0 }),
  );
  return pickMetHour(data.properties.timeseries, at);
}

/**
 * Forecast conditions for the hour of travel, so a walk planned for 11 pm uses
 * the 11 pm forecast rather than the weather right now. Open-Meteo first (it has
 * visibility), MET Norway as the fallback. Never fails a plan: null if both are out.
 */
export async function weatherAt(point: LngLat, at: Date): Promise<WeatherAt | null> {
  try {
    const w = await openMeteo(point, at);
    if (w) return w;
  } catch (err) {
    console.warn(`[weather] Open-Meteo: ${(err as Error).message}; trying MET Norway`);
  }
  try {
    return await metNorway(point, at);
  } catch (err) {
    console.warn(`[weather] MET Norway: ${(err as Error).message}`);
    return null;
  }
}
