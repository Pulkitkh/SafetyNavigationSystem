import type { NextRequest } from "next/server";
import { haversine, type LngLat } from "@/lib/geo";
import { nearbyHelp } from "@/lib/providers/street";
import { FeatureIndex, openProbability } from "@/lib/safety/score";
import { ApiError, json, rateLimit, route } from "@/lib/server/http";
import { appTimezone } from "@/lib/time";

export const GET = route(async (req: NextRequest) => {
  rateLimit(req, "help", 20, 60_000);
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new ApiError(400, "lat and lng are required");
  // Round so nearby users share cache entries (~110 m grid).
  const at: LngLat = [Math.round(lng * 1000) / 1000, Math.round(lat * 1000) / 1000];
  const { pois, source } = await nearbyHelp(at, 3000);
  const now = new Date();
  const tz = appTimezone();
  // Evaluates published opening hours (or typical hours) right now.
  const hours = new FeatureIndex({ roads: [], pois: [], areas: [] }, []);
  const places = pois
    .map((p) => {
      const { p: prob, known } = openProbability(hours, p, now, tz);
      return { ...p, distance: Math.round(haversine([lng, lat], p.point)), openNow: known ? prob >= 0.5 : prob >= 0.9 ? true : null };
    })
    .sort((a, b) => a.distance - b.distance);
  const pick = (kind: string, n: number) => places.filter((p) => p.kind === kind).slice(0, n);
  return json({ police: pick("police", 5), hospitals: pick("hospital", 5), pharmacies: pick("pharmacy", 3), fuel: pick("fuel", 3), source });
});
