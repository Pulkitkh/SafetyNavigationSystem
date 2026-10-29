import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ApiError, json, parseBody, rateLimit, requireUser, route } from "@/lib/server/http";
import { recordLive } from "@/lib/server/people";
import { ownedTrip, pruneTripPoints } from "@/lib/server/trips";
import { locationInput } from "@/lib/server/validation";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  const user = await requireUser();
  rateLimit(req, "trip-location", 40, 60_000);
  const { id } = await params;
  const trip = await ownedTrip(user.id, id);
  if (trip.status === "ended") throw new ApiError(409, "This trip has ended");
  const input = await parseBody(req, locationInput);
  const now = new Date();
  // Accept device timestamps for queued (offline) fixes, but never from the future.
  const recordedAt = input.at && input.at <= now.getTime() && now.getTime() - input.at < 3600_000 ? new Date(input.at) : now;
  const db = await getDb();
  await db.insert(schema.tripPoints).values({ tripId: id, lat: input.lat, lng: input.lng, accuracy: input.accuracy ?? null, recordedAt });
  if (!trip.lastSeenAt || recordedAt >= trip.lastSeenAt) {
    await db
      .update(schema.trips)
      .set({
        lastLat: input.lat,
        lastLng: input.lng,
        lastAccuracy: input.accuracy ?? null,
        lastBattery: input.battery ?? trip.lastBattery,
        lastSeenAt: recordedAt,
      })
      .where(eq(schema.trips.id, id));
    // Keep always-on sharing current during a journey too.
    if (user.shareLive) await recordLive(user.id, { lat: input.lat, lng: input.lng, accuracy: input.accuracy, battery: input.battery, at: recordedAt });
  }
  if (Math.random() < 0.05) await pruneTripPoints(id);
  return json({ ok: true, status: trip.status });
});
