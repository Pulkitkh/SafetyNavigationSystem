import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { mapsLink, sosMessage } from "@/lib/sos";
import { VEHICLE_LABELS, type VehicleType } from "@/lib/phone";
import { newId, sha256, type User } from "./auth";
import { alertContacts, repeatSosAlerts, type AlertPayload, type DeliveryResult } from "./alerts";
import { smsProvider, type SmsResult } from "./sms";
import { endOpenTrips, type Trip } from "./trips";

export type SosTrigger = "manual" | "missed_checkin" | "deviation";

const TRIGGER_REASON: Record<SosTrigger, string | null> = {
  manual: null,
  missed_checkin: "missed a safety check-in",
  deviation: "unexpected route change",
};

/** Live always-on locations older than this aren't used as an SOS location. */
const LIVE_FRESH_MS = 30 * 60_000;

export interface RaiseSosInput {
  user: User;
  trigger: SosTrigger;
  /** Overrides the reason derived from the trigger, e.g. "safety timer ran out". */
  reason?: string | null;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  /** The journey this SOS belongs to, if any. */
  tripId?: string | null;
  /** The share token the phone made. Absent when the server raises the SOS itself. */
  shareToken?: string | null;
  /** Public base URL for links. */
  base: string;
}

function newShareToken() {
  return randomBytes(24).toString("base64url");
}

/**
 * A share token for links the server sends about a trip. The server only keeps
 * the hash of the phone's token, so it derives one of its own from the trip id
 * and a server secret: the same trip always gets the same link.
 */
export async function serverShareToken(trip: Pick<Trip, "id" | "serverTokenHash">): Promise<string> {
  const secret = process.env.SHARE_TOKEN_SECRET?.trim() || process.env.VAPID_PRIVATE_KEY?.trim() || process.env.DATABASE_URL || "safenav";
  const token = createHmac("sha256", secret).update(`share:${trip.id}`).digest("base64url").slice(0, 32);
  if (trip.serverTokenHash !== sha256(token)) {
    const db = await getDb();
    await db.update(schema.trips).set({ serverTokenHash: sha256(token) }).where(eq(schema.trips.id, trip.id));
  }
  return token;
}

export function vehicleLine(trip: Pick<Trip, "vehicleType" | "vehiclePlate">) {
  if (!trip.vehiclePlate && !trip.vehicleType) return null;
  return [trip.vehicleType ? VEHICLE_LABELS[trip.vehicleType as VehicleType] : null, trip.vehiclePlate].filter(Boolean).join(" ");
}

/**
 * Raises an SOS: marks the trip (or a new one) as SOS, alerts every contact on
 * every channel that needs nothing from the phone, keeps ringing those who
 * don't answer, and records what reached whom. Used by the SOS button and by
 * the server watchdog when the phone itself has gone quiet.
 */
export async function raiseSos(input: RaiseSosInput) {
  const { user } = input;
  const db = await getDb();
  const now = new Date();
  let lat = input.lat ?? null;
  let lng = input.lng ?? null;
  let accuracy = input.accuracy ?? null;
  const fromDevice = lat != null && lng != null;
  const reason = input.reason !== undefined ? input.reason : TRIGGER_REASON[input.trigger];

  let tripId: string;
  let token = input.shareToken ?? "";
  let vehicle: string | null = null;
  const existing = input.tripId ? await db.query.trips.findFirst({ where: eq(schema.trips.id, input.tripId) }) : null;
  if (existing && existing.userId === user.id && existing.status !== "ended") {
    tripId = existing.id;
    vehicle = vehicleLine(existing);
    if (!fromDevice && existing.lastLat != null && existing.lastLng != null) {
      lat = existing.lastLat;
      lng = existing.lastLng;
      accuracy = existing.lastAccuracy;
    }
    // The device composes its SMS with the token it holds; keep the trip reachable by it.
    if (token && existing.shareTokenHash !== sha256(token)) token = "";
    if (!token) token = await serverShareToken(existing);
    await db
      .update(schema.trips)
      .set({
        status: "sos",
        alertReason: reason ?? "SOS",
        ...(fromDevice ? { lastLat: lat, lastLng: lng, lastAccuracy: accuracy, lastSeenAt: now } : {}),
      })
      .where(eq(schema.trips.id, tripId));
  } else {
    if (!fromDevice && user.liveLat != null && user.liveLng != null && user.liveAt && now.getTime() - user.liveAt.getTime() < LIVE_FRESH_MS) {
      lat = user.liveLat;
      lng = user.liveLng;
      accuracy = user.liveAccuracy;
    }
    // SOS outside a journey still gets a live link: it becomes a trip in "sos" state.
    await endOpenTrips(user.id);
    tripId = newId();
    if (!token) token = newShareToken();
    const here: [number, number] = lat != null && lng != null ? [lng, lat] : [0, 0];
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
      alertReason: reason ?? "SOS",
      ...(lat != null && lng != null ? { lastLat: lat, lastLng: lng, lastAccuracy: accuracy, lastSeenAt: fromDevice ? now : (user.liveAt ?? now) } : {}),
    });
  }
  const hasLocation = lat != null && lng != null;
  if (fromDevice) {
    await db.insert(schema.tripPoints).values({ tripId, lat: lat!, lng: lng!, accuracy, recordedAt: now });
  }
  // An SOS supersedes a running safety timer.
  await db.delete(schema.safetyTimers).where(eq(schema.safetyTimers.userId, user.id));

  const contacts = await db.select().from(schema.contacts).where(eq(schema.contacts.userId, user.id));
  const liveUrl = `${input.base}/t/${token}`;
  const message = sosMessage({ name: user.name, liveUrl, lat, lng, accuracyM: accuracy, vehicle, reason });

  // Everything that needs no action on the phone goes out at once, in parallel:
  // app alerts, Web Push, Telegram and WhatsApp to linked contacts, and a paid SMS gateway if configured.
  const provider = smsProvider();
  const sosPayload: AlertPayload = {
    kind: "sos",
    tripId,
    personUserId: user.id,
    title: `SOS: ${user.name} needs help`,
    body: [
      reason ? `Automatic alert: ${reason}.` : `${user.name} pressed SOS.`,
      vehicle ? `Vehicle: ${vehicle}.` : null,
      hasLocation
        ? `Tap to see their ${fromDevice ? "live" : "last known"} location, then call them. If you can't reach them, dial 112.`
        : "Their location isn't available yet. Call them now; if you can't reach them, dial 112.",
    ]
      .filter(Boolean)
      .join(" "),
    url: liveUrl,
    lat,
    lng,
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
          { name: user.name, link: liveUrl ?? (hasLocation ? mapsLink(lat!, lng!) : ""), place: hasLocation ? `${lat!.toFixed(5)},${lng!.toFixed(5)}` : "" },
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
  repeatSosAlerts(
    contacts.map((c) => c.id),
    sosPayload,
  );

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
    lat,
    lng,
    trigger: input.trigger,
    channel: [input.shareToken ? null : "server", alerts.length ? "alerts" : null, provider ? `gateway:${provider.name}` : null].filter(Boolean).join("+") || "device",
    delivered: reach.filter((r) => r.delivered.length).length,
    failed: reach.filter((r) => !r.delivered.length && r.failed.length).length,
  });

  return {
    tripId,
    liveUrl,
    message,
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, phone: c.phone, relation: c.relation })),
    gateway: provider ? { provider: provider.name, results } : null,
    reach,
  };
}
