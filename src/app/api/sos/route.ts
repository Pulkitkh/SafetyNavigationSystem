import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { mapsLink, sosMessage } from "@/lib/sos";
import { VEHICLE_LABELS, type VehicleType } from "@/lib/phone";
import { newId, sha256 } from "@/lib/server/auth";
import { json, parseBody, rateLimit, requireUser, route } from "@/lib/server/http";
import { alertContacts, repeatSosAlerts, type AlertPayload, type DeliveryResult } from "@/lib/server/alerts";
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

  // Everything that needs no action on the phone goes out at once, in parallel:
  // app notifications and Telegram to linked contacts, and a paid SMS gateway if configured.
  const provider = smsProvider();
  const reason = TRIGGER_REASON[input.trigger];
  const sosPayload: AlertPayload = {
    kind: "sos",
    tripId,
    personUserId: user.id,
    title: `SOS: ${user.name} needs help`,
    body: [
      reason ? `Automatic alert: ${reason}.` : `${user.name} pressed SOS.`,
      vehicle ? `Vehicle: ${vehicle}.` : null,
      hasLocation ? "Tap to see their live location, then call them. If you can't reach them, dial 112." : "Their location isn't available yet. Call them now; if you can't reach them, dial 112.",
    ]
      .filter(Boolean)
      .join(" "),
    url: liveUrl,
    lat: input.lat,
    lng: input.lng,
  };
  const [alerts, results] = await Promise.all([
    alertContacts(
      contacts.map((c) => c.id),
      sosPayload,
    ).catch((err): DeliveryResult[] => {
      console.error(`[sos] alerts: ${(err as Error).message}`);
      return [];
    }),
    provider && contacts.length
      ? provider.send(
          contacts.map((c) => c.phone),
          message,
          { name: user.name, link: liveUrl ?? (hasLocation ? mapsLink(input.lat!, input.lng!) : ""), place: hasLocation ? `${input.lat!.toFixed(5)},${input.lng!.toFixed(5)}` : "" },
        )
      : Promise.resolve([] as SmsResult[]),
  ]);
  if (results.length) {
    await db.insert(schema.alertDeliveries).values(
      results.map((r) => ({
        tripId,
        contactId: contacts.find((c) => c.phone === r.to)?.id ?? null,
        kind: "sos",
        channel: "sms_gateway",
        ok: r.ok,
        error: r.error?.slice(0, 200) ?? null,
      })),
    );
  }

  // Keep ringing anyone who hasn't opened or answered it yet.
  repeatSosAlerts(contacts.map((c) => c.id), sosPayload);

  // Per contact: the channels that reached them without the phone doing anything.
  const reach = contacts.map((c) => ({
    contactId: c.id,
    delivered: [...alerts.filter((a) => a.contactId === c.id && a.ok).map((a) => a.channel), ...results.filter((r) => r.to === c.phone && r.ok).map(() => "sms_gateway")],
    failed: [...alerts.filter((a) => a.contactId === c.id && !a.ok).map((a) => a.channel), ...results.filter((r) => r.to === c.phone && !r.ok).map(() => "sms_gateway")],
  }));

  await db.insert(schema.sosEvents).values({
    id: newId(),
    userId: user.id,
    tripId,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    trigger: input.trigger,
    channel: [alerts.length ? "alerts" : null, provider ? `gateway:${provider.name}` : null].filter(Boolean).join("+") || "device",
    delivered: reach.filter((r) => r.delivered.length).length,
    failed: reach.filter((r) => !r.delivered.length && r.failed.length).length,
  });

  return json({
    tripId,
    liveUrl,
    message,
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, phone: c.phone, relation: c.relation })),
    gateway: provider ? { provider: provider.name, results } : null,
    reach,
  });
});
