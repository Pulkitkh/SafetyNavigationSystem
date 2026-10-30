import type { NextRequest } from "next/server";
import { prewarmAround } from "@/lib/providers/street";
import { ApiError, json, rateLimit, route } from "@/lib/server/http";

/**
 * Starts downloading the street data around a point in the background, so the
 * first route or area check there is quick. Called once when the app learns
 * where the user is; returns at once.
 */
export const POST = route(async (req: NextRequest) => {
  rateLimit(req, "prewarm", 6, 10 * 60_000);
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new ApiError(400, "lat and lng are required");
  prewarmAround([Math.round(lng * 1000) / 1000, Math.round(lat * 1000) / 1000], 1500);
  return json({ ok: true }, 202);
});
