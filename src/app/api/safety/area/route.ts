import type { NextRequest } from "next/server";
import type { LngLat } from "@/lib/geo";
import { fetchAreaFeatures } from "@/lib/providers/overpass";
import { weatherAt } from "@/lib/providers/weather";
import { scoreArea } from "@/lib/safety/area";
import { loadReports } from "@/lib/safety/plan";
import { FeatureIndex } from "@/lib/safety/score";
import { ApiError, json, rateLimit, route } from "@/lib/server/http";
import { appTimezone } from "@/lib/time";

export const maxDuration = 60;

export const GET = route(async (req: NextRequest) => {
  rateLimit(req, "area", 20, 60_000);
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new ApiError(400, "lat and lng are required");
  const point: LngLat = [lng, lat];
  const now = new Date();
  const [features, reports, weather] = await Promise.all([fetchAreaFeatures(point), loadReports([[point]], 250).catch(() => []), weatherAt(point, now)]);
  const area = scoreArea(point, new FeatureIndex(features, reports), {
    at: now,
    tz: appTimezone(),
    raining: !!weather?.isRaining,
    foggy: !!weather?.foggy,
  });
  return json({ area, weather: weather && { isRaining: weather.isRaining, foggy: weather.foggy }, at: now.toISOString() });
});
