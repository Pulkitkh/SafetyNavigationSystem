import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { simplify, type LngLat } from "@/lib/geo";
import { ApiError, json, parseBody, rateLimit, requireUser, route } from "@/lib/server/http";
import { expectedArrivalFor, ownedTrip } from "@/lib/server/trips";
import { rerouteInput } from "@/lib/server/validation";

type Ctx = { params: Promise<{ id: string }> };

/** Replace the planned route of an open trip; the live link and deviation checks follow the new one. */
export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  const user = await requireUser();
  rateLimit(req, "trip-reroute", 30, 60 * 60_000);
  const { id } = await params;
  const trip = await ownedTrip(user.id, id);
  if (trip.status === "ended") throw new ApiError(409, "This trip has already ended");
  const input = await parseBody(req, rerouteInput);
  const expectedArrival = expectedArrivalFor(trip.mode, input.durationS);
  const db = await getDb();
  await db
    .update(schema.trips)
    .set({ routeJson: JSON.stringify(simplify(input.route as LngLat[], 3)), expectedArrival })
    .where(eq(schema.trips.id, id));
  return json({ trip: { id, expectedArrival } });
});
