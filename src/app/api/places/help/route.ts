import type { NextRequest } from "next/server";
import { helpNear } from "@/lib/safety/checks";
import { ApiError, json, rateLimit, route } from "@/lib/server/http";

export const GET = route(async (req: NextRequest) => {
  rateLimit(req, "help", 20, 60_000);
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new ApiError(400, "lat and lng are required");
  return json(await helpNear([lng, lat]));
});
