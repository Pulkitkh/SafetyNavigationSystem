import type { NextRequest } from "next/server";
import { searchPlaces } from "@/lib/providers/geocode";
import { json, rateLimit, route } from "@/lib/server/http";

export const GET = route(async (req: NextRequest) => {
  rateLimit(req, "search", 60, 60_000);
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 3) return json({ places: [] });
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const near = Number.isFinite(lng) && Number.isFinite(lat) && (lng !== 0 || lat !== 0) ? ([lng, lat] as [number, number]) : undefined;
  return json({ places: await searchPlaces(q.slice(0, 120), near) });
});
