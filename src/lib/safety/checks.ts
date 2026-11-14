import { haversine, type LngLat } from "@/lib/geo";
import { nearbyHelp, pointData, prewarmAround } from "@/lib/providers/street";
import { weatherAt } from "@/lib/providers/weather";
import { appTimezone } from "@/lib/time";
import { scoreArea, type AreaSafety } from "./area";
import { loadReports } from "./plan";
import { FeatureIndex, openProbability } from "./score";

export interface AreaCheck {
  area: AreaSafety;
  source: string | undefined;
  weather: { isRaining: boolean; foggy: boolean } | null;
  at: string;
}

/** "Is it safe here right now?" for one point: lighting, open places, isolation, police distance, reports and weather. */
export async function checkArea(point: LngLat, now = new Date(), { prewarm = true } = {}): Promise<AreaCheck> {
  const [data, reports, weather] = await Promise.all([pointData(point), loadReports([[point]], 250).catch(() => []), weatherAt(point, now)]);
  // Fetch the neighbourhood's streets in the background, so plans and checks nearby are instant.
  if (prewarm) prewarmAround(point);
  const area = scoreArea(point, new FeatureIndex(data.features, reports, { tileBoxes: data.tileBoxes }), {
    at: now,
    tz: appTimezone(),
    raining: !!weather?.isRaining,
    foggy: !!weather?.foggy,
  });
  return { area, source: data.features.source, weather: weather && { isRaining: weather.isRaining, foggy: weather.foggy }, at: now.toISOString() };
}

export interface HelpPlace {
  id: string;
  name?: string;
  phone?: string;
  kind: string;
  point: LngLat;
  distance: number;
  openNow: boolean | null;
}

export interface HelpNearby {
  police: HelpPlace[];
  hospitals: HelpPlace[];
  pharmacies: HelpPlace[];
  fuel: HelpPlace[];
  source: string;
}

/** Police stations, hospitals, pharmacies and petrol pumps near a point, nearest first, with whether each is open now. */
export async function helpNear(point: LngLat, now = new Date()): Promise<HelpNearby> {
  // Round so nearby users share cache entries (~110 m grid).
  const at: LngLat = [Math.round(point[0] * 1000) / 1000, Math.round(point[1] * 1000) / 1000];
  const { pois, source } = await nearbyHelp(at, 3000);
  const tz = appTimezone();
  // Evaluates published opening hours (or typical hours) right now.
  const hours = new FeatureIndex({ roads: [], pois: [], areas: [] }, []);
  const places = pois
    .map((p) => {
      const { p: prob, known } = openProbability(hours, p, now, tz);
      return { ...p, distance: Math.round(haversine(point, p.point)), openNow: known ? prob >= 0.5 : prob >= 0.9 ? true : null };
    })
    .sort((a, b) => a.distance - b.distance);
  const pick = (kind: string, n: number) => places.filter((p) => p.kind === kind).slice(0, n);
  return { police: pick("police", 5), hospitals: pick("hospital", 5), pharmacies: pick("pharmacy", 3), fuel: pick("fuel", 3), source };
}
