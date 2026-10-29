import type { NextRequest } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId, sha256 } from "@/lib/server/auth";
import { alertContacts } from "@/lib/server/alerts";
import { json, parseBody, rateLimit, requireUser, route } from "@/lib/server/http";
import { shareUrl } from "@/lib/server/url";
import { VEHICLE_LABELS, type VehicleType } from "@/lib/phone";
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
  let notified = 0;
  if (input.notifyContacts) {
    const contacts = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.userId, user.id));
    const time = expectedArrival.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata" });
    const vehicle = [input.vehicleType ? VEHICLE_LABELS[input.vehicleType as VehicleType] : null, input.vehiclePlate].filter(Boolean).join(" ");
    const results = await alertContacts(
      contacts.map((c) => c.id),
      {
        kind: "journey",
        tripId: trip.id,
        title: `${user.name} started a ${input.mode === "ride" ? "ride" : "walk"}`,
        body: `Going to ${input.destLabel}${vehicle ? ` in ${vehicle}` : ""}, expected by ${time}. Tap to follow live. You'll be alerted if anything looks wrong.`,
        url: shareUrl(req, input.shareToken),
      },
    ).catch(() => []);
    notified = new Set(results.filter((r) => r.ok).map((r) => r.contactId)).size;
  }
  return json({ trip: { id: trip.id, status: trip.status, expectedArrival: trip.expectedArrival }, notified }, 201);
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
