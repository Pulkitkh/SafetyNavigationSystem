import type { NextRequest } from "next/server";
import type { LngLat } from "@/lib/geo";
import { pointData, prewarmAround } from "@/lib/providers/street";
import { weatherAt } from "@/lib/providers/weather";
import { scoreArea } from "@/lib/safety/area";
import { loadReports } from "@/lib/safety/plan";
import { FeatureIndex } from "@/lib/safety/score";
import { ApiError, json, rateLimit, route } from "@/lib/server/http";
import { appTimezone } from "@/lib/time";

export const maxDuration = 60;

function parsePoint(req: NextRequest): LngLat {
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new ApiError(400, "lat and lng are required");
  return [lng, lat];
}

export const GET = route(async (req: NextRequest) => {
  rateLimit(req, "area", 20, 60_000);
  const point = parsePoint(req);
  const now = new Date();
  const [data, reports, weather] = await Promise.all([pointData(point), loadReports([[point]], 250).catch(() => []), weatherAt(point, now)]);
  // Fetch the neighbourhood's streets in the background, so plans and checks nearby are instant.
  prewarmAround(point);
  const area = scoreArea(point, new FeatureIndex(data.features, reports, { tileBoxes: data.tileBoxes }), {
    at: now,
    tz: appTimezone(),
    raining: !!weather?.isRaining,
    foggy: !!weather?.foggy,
  });
  return json({ area, source: data.features.source, weather: weather && { isRaining: weather.isRaining, foggy: weather.foggy }, at: now.toISOString() });
});
