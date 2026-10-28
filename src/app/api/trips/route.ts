import type { NextRequest } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId, sha256 } from "@/lib/server/auth";
import { json, parseBody, rateLimit, requireUser, route } from "@/lib/server/http";
import { endOpenTrips, expectedArrivalFor } from "@/lib/server/trips";
import { startTripInput } from "@/lib/server/validation";
import { simplify, type LngLat } from "@/lib/geo";

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser();
  rateLimit(req, "trip-start", 20, 60 * 60_000);
  const input = await parseBody(req, startTripInput);
  await endOpenTrips(user.id);
  const expectedArrival = expectedArrivalFor(input.mode, input.durationS);
  const route = simplify(input.route as LngLat[], 3);
  const db = await getDb();
  const [trip] = await db
    .insert(schema.trips)
    .values({
      id: newId(),
      userId: user.id,
      shareTokenHash: sha256(input.shareToken),
      mode: input.mode,
      destLabel: input.destLabel,
      destLng: input.dest[0],
      destLat: input.dest[1],
      routeJson: JSON.stringify(route),
      expectedArrival,
      vehicleType: input.vehicleType ?? null,
      vehiclePlate: input.vehiclePlate ?? null,
      vehicleNote: input.vehicleNote ?? null,
    })
    .returning();
  return json({ trip: { id: trip.id, status: trip.status, expectedArrival: trip.expectedArrival } }, 201);
});

/** The user's open trip, if any, so a reload or a second device can resume monitoring. */
export const GET = route(async () => {
  const user = await requireUser();
  const db = await getDb();
  const trip = await db.query.trips.findFirst({
    where: and(eq(schema.trips.userId, user.id), inArray(schema.trips.status, ["active", "alert", "sos"])),
    orderBy: desc(schema.trips.startedAt),
  });
  return json({
    trip: trip && {
      id: trip.id,
      mode: trip.mode,
      status: trip.status,
      destLabel: trip.destLabel,
      dest: [trip.destLng, trip.destLat],
      route: JSON.parse(trip.routeJson),
      expectedArrival: trip.expectedArrival,
      vehicleType: trip.vehicleType,
      vehiclePlate: trip.vehiclePlate,
      startedAt: trip.startedAt,
    },
  });
});
