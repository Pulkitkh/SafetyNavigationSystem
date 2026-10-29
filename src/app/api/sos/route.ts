import type { NextRequest } from "next/server";
import { json, parseBody, rateLimit, requireUser, route } from "@/lib/server/http";
import { raiseSos } from "@/lib/server/sos";
import { appUrl } from "@/lib/server/url";
import { sosInput } from "@/lib/server/validation";

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser();
  rateLimit(req, "sos", 10, 10 * 60_000);
  const input = await parseBody(req, sosInput);
  const hasLocation = input.lat != null && input.lng != null;
  return json(
    await raiseSos({
      user,
      trigger: input.trigger,
      lat: hasLocation ? input.lat : null,
      lng: hasLocation ? input.lng : null,
      accuracy: hasLocation ? (input.accuracy ?? null) : null,
      tripId: input.tripId,
      shareToken: input.shareToken,
      base: appUrl(req),
    }),
  );
});
