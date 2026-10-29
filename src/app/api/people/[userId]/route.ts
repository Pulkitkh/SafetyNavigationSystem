import type { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { markSeenByContact } from "@/lib/server/alerts";
import { json, requireUser, route } from "@/lib/server/http";
import { personFor } from "@/lib/server/people";

type Ctx = { params: Promise<{ userId: string }> };

/** One person you protect, with their planned route and recent trail during a journey or SOS. */
export const GET = route(async (_req: NextRequest, { params }: Ctx) => {
  const me = await requireUser();
  const { userId } = await params;
  const person = await personFor(me.id, userId);
  let route: [number, number][] = [];
  let trail: [number, number][] = [];
  if (person.trip) {
    // Opening it in the app tells the person in danger their contact has seen the alert.
    if (person.trip.status === "sos") await markSeenByContact(person.trip.id, person.contactId);
    const db = await getDb();
    const trip = await db.query.trips.findFirst({ where: and(eq(schema.trips.id, person.trip.id), eq(schema.trips.userId, userId)) });
    if (trip && trip.destLabel !== "SOS alert") route = JSON.parse(trip.routeJson);
    const points = await db
      .select({ lat: schema.tripPoints.lat, lng: schema.tripPoints.lng })
      .from(schema.tripPoints)
      .where(eq(schema.tripPoints.tripId, person.trip.id))
      .orderBy(desc(schema.tripPoints.recordedAt))
      .limit(300);
    trail = points.reverse().map((p) => [p.lng, p.lat]);
  }
  return json({ person, route, trail });
});
