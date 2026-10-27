import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { mapsLink, sosMessage } from "@/lib/sos";
import { VEHICLE_LABELS, type VehicleType } from "@/lib/phone";
import { newId, sha256 } from "@/lib/server/auth";
import { json, parseBody, rateLimit, requireUser, route } from "@/lib/server/http";
import { smsProvider, type SmsResult } from "@/lib/server/sms";
import { endOpenTrips, ownedTrip } from "@/lib/server/trips";
import { shareUrl } from "@/lib/server/url";
import { sosInput } from "@/lib/server/validation";

const TRIGGER_REASON = {
  manual: null,
  missed_checkin: "missed a safety check-in",
  deviation: "unexpected route change",
} as const;

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser();
  rateLimit(req, "sos", 10, 10 * 60_000);
  const input = await parseBody(req, sosInput);
  const db = await getDb();
  const hasLocation = input.lat != null && input.lng != null;
  const now = new Date();

  let tripId: string;
  let token = input.shareToken;
  let vehicle: string | null = null;
  const existing = input.tripId ? await ownedTrip(user.id, input.tripId).catch(() => null) : null;
  if (existing && existing.status !== "ended") {
    tripId = existing.id;
    // The device composes its SMS with the token it holds; keep the trip reachable by it.
    if (existing.shareTokenHash !== sha256(token)) token = "";
    if (existing.vehiclePlate || existing.vehicleType) {
      vehicle = [existing.vehicleType ? VEHICLE_LABELS[existing.vehicleType as VehicleType] : null, existing.vehiclePlate].filter(Boolean).join(" ");
    }
    await db
      .update(schema.trips)
      .set({
        status: "sos",
        alertReason: TRIGGER_REASON[input.trigger] ?? "SOS",
        ...(hasLocation ? { lastLat: input.lat, lastLng: input.lng, lastAccuracy: input.accuracy ?? null, lastSeenAt: now } : {}),
      })
      .where(eq(schema.trips.id, tripId));
  } else {
    // SOS outside a journey still gets a live link: it becomes a trip in "sos" state.
    await endOpenTrips(user.id);
    tripId = newId();
    const here: [number, number] = hasLocation ? [input.lng!, input.lat!] : [0, 0];
    await db.insert(schema.trips).values({
      id: tripId,
      userId: user.id,
      shareTokenHash: sha256(token),
      mode: "walk",
      status: "sos",
      destLabel: "SOS alert",
      destLng: here[0],
      destLat: here[1],
      routeJson: JSON.stringify([here, here]),
      expectedArrival: now,
      alertReason: TRIGGER_REASON[input.trigger] ?? "SOS",
      ...(hasLocation ? { lastLat: input.lat, lastLng: input.lng, lastAccuracy: input.accuracy ?? null, lastSeenAt: now } : {}),
    });
  }
  if (hasLocation) {
    await db.insert(schema.tripPoints).values({ tripId, lat: input.lat!, lng: input.lng!, accuracy: input.accuracy ?? null, recordedAt: now });
  }

  const contacts = await db.select().from(schema.contacts).where(eq(schema.contacts.userId, user.id));
  const liveUrl = token ? shareUrl(req, token) : null;
  const message = sosMessage({
    name: user.name,
    liveUrl,
    lat: input.lat,
    lng: input.lng,
    accuracyM: input.accuracy,
    vehicle,
    reason: TRIGGER_REASON[input.trigger],
  });

  const provider = smsProvider();
  let results: SmsResult[] = [];
  if (provider && contacts.length) {
    results = await provider.send(
      contacts.map((c) => c.phone),
      message,
      { name: user.name, link: liveUrl ?? (hasLocation ? mapsLink(input.lat!, input.lng!) : ""), place: hasLocation ? `${input.lat!.toFixed(5)},${input.lng!.toFixed(5)}` : "" },
    );
  }

  await db.insert(schema.sosEvents).values({
    id: newId(),
    userId: user.id,
    tripId,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    trigger: input.trigger,
    channel: provider ? `gateway:${provider.name}` : "device",
    delivered: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  });

  return json({
    tripId,
    liveUrl,
    message,
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, phone: c.phone, relation: c.relation })),
    gateway: provider ? { provider: provider.name, results } : null,
  });
});
