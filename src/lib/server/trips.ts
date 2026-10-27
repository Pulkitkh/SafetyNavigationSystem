import { and, asc, count, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ApiError } from "./http";

export type Trip = typeof schema.trips.$inferSelect;

/** Shared links stay viewable this long after a trip ends, so guardians see the final state. */
export const SHARE_GRACE_MS = 2 * 3600_000;
/** A trip that stops reporting is closed after this long. */
export const TRIP_MAX_MS = 12 * 3600_000;

export async function ownedTrip(userId: string, tripId: string): Promise<Trip> {
  const db = await getDb();
  const trip = await db.query.trips.findFirst({ where: and(eq(schema.trips.id, tripId), eq(schema.trips.userId, userId)) });
  if (!trip) throw new ApiError(404, "Trip not found");
  return trip;
}

export async function endOpenTrips(userId: string) {
  const db = await getDb();
  await db
    .update(schema.trips)
    .set({ status: "ended", endedAt: new Date() })
    .where(and(eq(schema.trips.userId, userId), inArray(schema.trips.status, ["active", "alert", "sos"])));
}

export function isShareVisible(trip: Trip, now = Date.now()) {
  if (trip.status === "ended") return !!trip.endedAt && now - trip.endedAt.getTime() < SHARE_GRACE_MS;
  return now - trip.startedAt.getTime() < TRIP_MAX_MS + SHARE_GRACE_MS;
}

/** Keep each trip's breadcrumb trail bounded by dropping the oldest points in batches. */
export async function pruneTripPoints(tripId: string, keep = 1500, batch = 200) {
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.tripPoints).where(eq(schema.tripPoints.tripId, tripId));
  if (n <= keep + batch) return;
  const oldest = await db
    .select({ id: schema.tripPoints.id })
    .from(schema.tripPoints)
    .where(eq(schema.tripPoints.tripId, tripId))
    .orderBy(asc(schema.tripPoints.id))
    .limit(n - keep);
  await db.delete(schema.tripPoints).where(inArray(schema.tripPoints.id, oldest.map((o) => o.id)));
}
