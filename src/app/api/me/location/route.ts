import type { NextRequest } from "next/server";
import { recordLive } from "@/lib/server/people";
import { json, parseBody, rateLimit, requireUser, route } from "@/lib/server/http";
import { locationInput } from "@/lib/server/validation";

/** Always-on location sharing: the app reports where the user is, about once a minute. */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser();
  rateLimit(req, "me-location", 30, 60_000);
  const input = await parseBody(req, locationInput);
  if (!user.shareLive) return json({ ok: true, sharing: false });
  const now = Date.now();
  const at = input.at && input.at <= now && now - input.at < 3600_000 ? new Date(input.at) : new Date(now);
  // Don't let a late-arriving old fix overwrite a newer one.
  if (!user.liveAt || at >= user.liveAt) await recordLive(user.id, { lat: input.lat, lng: input.lng, accuracy: input.accuracy, battery: input.battery, at });
  return json({ ok: true, sharing: true });
});
