import type { NextRequest } from "next/server";
import type { LngLat } from "@/lib/geo";
import { pointData } from "@/lib/providers/street";
import { weatherAt } from "@/lib/providers/weather";
import { scanLocality, SCAN_RADIUS_M } from "@/lib/safety/locality";
import { loadReports } from "@/lib/safety/plan";
import { FeatureIndex } from "@/lib/safety/score";
import { ApiError, json, rateLimit, route } from "@/lib/server/http";
import { appTimezone } from "@/lib/time";

export const maxDuration = 60;

/** Nearby streets to avoid and safer places, now and after dark, for about a kilometre around a point. */
export const GET = route(async (req: NextRequest) => {
  rateLimit(req, "nearby", 10, 60_000);
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new ApiError(400, "lat and lng are required");
  const point: LngLat = [lng, lat];
  const now = new Date();
  const [data, reports, weather] = await Promise.all([pointData(point, SCAN_RADIUS_M + 200, 20_000), loadReports([[point]], SCAN_RADIUS_M + 200).catch(() => []), weatherAt(point, now)]);
  const index = new FeatureIndex(data.features, reports, { tileBoxes: data.tileBoxes });
  const scan = scanLocality(point, index, { at: now, tz: appTimezone(), raining: !!weather?.isRaining, foggy: !!weather?.foggy });
  return json({ scan, cells: data.cells });
});
