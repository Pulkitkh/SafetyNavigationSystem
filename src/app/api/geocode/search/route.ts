import type { NextRequest } from "next/server";
import type { LngLat } from "@/lib/geo";
import { isShortMapLink, parseLocationInput, parseMapLink, recoverPlusCode } from "@/lib/location-input";
import { expandShortLink, reverseGeocode, searchPlaces, type Place } from "@/lib/providers/geocode";
import { ApiError, json, rateLimit, route } from "@/lib/server/http";

/** A recognised point (coordinates, link or plus code), named by reverse geocoding when possible. */
async function placeAt(point: LngLat, fallbackLabel: string): Promise<Place> {
  try {
    const p = await reverseGeocode(point);
    return { ...p, source: "input" };
  } catch {
    return { label: fallbackLabel, detail: `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`, lng: point[0], lat: point[1], source: "input" };
  }
}

export const GET = route(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const deep = sp.get("deep") === "1";
  rateLimit(req, deep ? "search-deep" : "search", deep ? 20 : 90, 60_000);
  const q = sp.get("q")?.trim().slice(0, 500) ?? "";
  if (q.length < 2) return json({ places: [] });
  const lng = Number(sp.get("lng"));
  const lat = Number(sp.get("lat"));
  const near = Number.isFinite(lng) && Number.isFinite(lat) && (lng !== 0 || lat !== 0) ? ([lng, lat] as LngLat) : undefined;

  // Pasted coordinates, map links and plus codes resolve directly.
  const parsed = parseLocationInput(q);
  if (parsed?.kind === "point") return json({ places: [await placeAt(parsed.point, "Pinned location")] });
  if (parsed?.kind === "shortlink" && isShortMapLink(q)) {
    const long = await expandShortLink(q).catch(() => q);
    const point = parseMapLink(long);
    if (point) return json({ places: [await placeAt(point, "Shared location")] });
    // Links to a named place carry its name instead of coordinates: search for it.
    const name = (() => {
      try {
        return new URL(long).searchParams.get("q") ?? decodeURIComponent(/\/maps\/place\/([^/@]+)/.exec(long)?.[1] ?? "").replace(/\+/g, " ");
      } catch {
        return "";
      }
    })();
    if (name.trim().length >= 2) return json(await searchPlaces(name.trim().slice(0, 120), near, { deep: true }));
    throw new ApiError(422, "Couldn't read a location from that link. Open it and copy the coordinates instead.");
  }
  if (parsed?.kind === "shortcode") {
    let ref = near;
    if (parsed.locality) {
      const { places } = await searchPlaces(parsed.locality, near);
      if (places[0]) ref = [places[0].lng, places[0].lat];
    }
    if (!ref) throw new ApiError(422, `Add a city after the code, e.g. "${parsed.code} Indore", or allow location access.`);
    return json({ places: [await placeAt(recoverPlusCode(parsed.code, ref), parsed.code)] });
  }

  return json(await searchPlaces(q.slice(0, 120), near, { deep }));
});
