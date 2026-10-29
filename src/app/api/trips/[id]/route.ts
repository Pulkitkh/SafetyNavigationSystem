import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { alertContacts } from "@/lib/server/alerts";
import { ApiError, json, parseBody, requireUser, route } from "@/lib/server/http";
import { ownedTrip } from "@/lib/server/trips";
import { tripStatusInput } from "@/lib/server/validation";

type Ctx = { params: Promise<{ id: string }> };

/** Update the trip state guardians see: "alert" while a check-in is pending, "ended" on arrival or "I'm safe". */
export const PATCH = route(async (req: NextRequest, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  const trip = await ownedTrip(user.id, id);
  const input = await parseBody(req, tripStatusInput);
  if (trip.status === "ended") throw new ApiError(409, "This trip has already ended");
  // An SOS can only be cleared by ending the trip, so a single tap can't silently cancel it.
  if (trip.status === "sos" && input.status !== "ended") throw new ApiError(409, "End the trip to clear an SOS");
  const db = await getDb();
  await db
    .update(schema.trips)
    .set({
      status: input.status,
      alertReason: input.status === "alert" ? (input.reason ?? "Check-in pending") : input.status === "ended" ? (input.reason ?? null) : null,
      endedAt: input.status === "ended" ? new Date() : null,
    })
    .where(eq(schema.trips.id, id));
  // Everyone who got the SOS automatically also hears, automatically, that it's over.
  if (trip.status === "sos" && input.status === "ended") {
    const reached = await db
      .selectDistinct({ contactId: schema.alertDeliveries.contactId })
      .from(schema.alertDeliveries)
      .where(and(eq(schema.alertDeliveries.tripId, id), eq(schema.alertDeliveries.kind, "sos"), eq(schema.alertDeliveries.ok, true)));
    const ids = reached.map((r) => r.contactId).filter((c): c is string => !!c);
    await alertContacts(ids, {
      kind: "safe",
      tripId: id,
      title: `${user.name} is safe`,
      body: `${user.name} ended the SOS and marked themselves safe${input.reason && input.reason !== "Marked safe" ? ` (${input.reason})` : ""}. You may still want to call them.`,
      url: null,
    }).catch((err) => console.error(`[trips] safe alert: ${(err as Error).message}`));
  }
  return json({ ok: true });
});
