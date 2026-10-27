import type { NextRequest } from "next/server";
import { reverseGeocode } from "@/lib/providers/geocode";
import { ApiError, json, rateLimit, route } from "@/lib/server/http";

export const GET = route(async (req: NextRequest) => {
  rateLimit(req, "reverse", 30, 60_000);
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new ApiError(400, "lat and lng are required");
  }
  return json({ place: await reverseGeocode([lng, lat]) });
});
