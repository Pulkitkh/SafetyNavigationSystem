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

/**
 * Forecast conditions for the hour of travel from Open-Meteo (free, no key), so a
 * walk planned for 11 pm uses the 11 pm forecast rather than the weather right now.
 */
export async function weatherAt(point: LngLat, at: Date): Promise<WeatherAt | null> {
  const base = process.env.OPEN_METEO_URL || "https://api.open-meteo.com";
  const params = new URLSearchParams({
    latitude: point[1].toFixed(2),
    longitude: point[0].toFixed(2),
    hourly: "precipitation,weather_code,visibility",
    timezone: "GMT",
    past_days: "1",
    forecast_days: "8",
  });
  const url = `${base}/v1/forecast?${params}`;
  try {
    const data = await cached("meteo-hourly", url, 30 * 60_000, () =>
      fetchJson<HourlyResponse>(url, { service: "weather", timeoutMs: 6000, retries: 0 }),
    );
    return pickHour(data, at);
  } catch {
    return null; // weather is a modifier; never fail a route plan over it
  }
}
