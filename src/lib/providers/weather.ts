import type { LngLat } from "@/lib/geo";
import { cached, fetchJson } from "./http";

export interface WeatherNow {
  precipitationMm: number;
  weatherCode: number;
  isRaining: boolean;
}

/** Current conditions from Open-Meteo (free, no key). Rain empties streets, which matters at night. */
export async function currentWeather(point: LngLat): Promise<WeatherNow | null> {
  const base = process.env.OPEN_METEO_URL || "https://api.open-meteo.com";
  const params = new URLSearchParams({
    latitude: point[1].toFixed(2),
    longitude: point[0].toFixed(2),
    current: "precipitation,weather_code",
  });
  const url = `${base}/v1/forecast?${params}`;
  try {
    const data = await cached("meteo", url, 15 * 60_000, () =>
      fetchJson<{ current: { precipitation: number; weather_code: number } }>(url, { service: "weather", timeoutMs: 6000, retries: 0 }),
    );
    const p = data.current.precipitation ?? 0;
    const code = data.current.weather_code ?? 0;
    // WMO codes 51–67 drizzle/rain, 80–82 showers, 95–99 thunderstorm.
    const rainy = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
    return { precipitationMm: p, weatherCode: code, isRaining: rainy || p >= 0.5 };
  } catch {
    return null; // weather is a minor modifier; never fail a route plan over it
  }
}
