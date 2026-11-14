import type { NextRequest } from "next/server";
import type { LngLat } from "@/lib/geo";
import { checkArea } from "@/lib/safety/checks";
import { ApiError, json, rateLimit, route } from "@/lib/server/http";

export const maxDuration = 60;

function parsePoint(req: NextRequest): LngLat {
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new ApiError(400, "lat and lng are required");
  return [lng, lat];
}

export const GET = route(async (req: NextRequest) => {
  rateLimit(req, "area", 20, 60_000);
  return json(await checkArea(parsePoint(req)));
});
