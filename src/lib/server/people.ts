import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ApiError } from "./http";

/** Live positions older than this are shown as "last seen", not "live". */
export const LIVE_FRESH_MS = 5 * 60_000;

export interface LiveFix {
  lat: number;
  lng: number;
  accuracy?: number | null;
  battery?: number | null;
  at: Date;
}

/** Stores the user's latest position for always-on sharing; ignored unless they turned sharing on. */
export async function recordLive(userId: string, fix: LiveFix) {
  const db = await getDb();
  await db
    .update(schema.users)
    .set({ liveLat: fix.lat, liveLng: fix.lng, liveAccuracy: fix.accuracy ?? null, liveBattery: fix.battery ?? null, liveAt: fix.at })
    .where(and(eq(schema.users.id, userId), eq(schema.users.shareLive, true)));
}

type Trip = typeof schema.trips.$inferSelect;
type User = typeof schema.users.$inferSelect;

export interface PersonSummary {
  userId: string;
  contactId: string;
  name: string;
  phone: string | null;
  /** How they described you when they added you. */
  relation: string;
  sharing: boolean;
  status: "sos" | "alert" | "journey" | "sharing" | "idle";
  location: { lat: number; lng: number; accuracy: number | null; at: string; battery: number | null; source: "live" | "trip" } | null;
  trip: {
    id: string;
    mode: "walk" | "ride";
    status: Trip["status"];
    destLabel: string;
    dest: [number, number] | null;
    expectedArrival: string;
    alertReason: string | null;
    vehicle: string | null;
    startedAt: string;
  } | null;
  myResponse: string | null;
}

function summarise(contact: typeof schema.contacts.$inferSelect, user: User, trip: Trip | undefined, myResponse: string | null): PersonSummary {
  const tripLoc =
    trip && trip.lastLat != null && trip.lastLng != null && trip.lastSeenAt
      ? { lat: trip.lastLat, lng: trip.lastLng, accuracy: trip.lastAccuracy, at: trip.lastSeenAt, battery: trip.lastBattery, source: "trip" as const }
      : null;
  const liveLoc =
    user.shareLive && user.liveLat != null && user.liveLng != null && user.liveAt
      ? { lat: user.liveLat, lng: user.liveLng, accuracy: user.liveAccuracy, at: user.liveAt, battery: user.liveBattery, source: "live" as const }
      : null;
  // A journey or SOS shares location by itself; otherwise only if the person turned always-on sharing on.
  const best = [tripLoc, liveLoc].filter((l): l is NonNullable<typeof l> => !!l).sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;
  const status: PersonSummary["status"] =
    trip?.status === "sos" ? "sos" : trip?.status === "alert" ? "alert" : trip ? "journey" : user.shareLive ? "sharing" : "idle";
  return {
    userId: user.id,
    contactId: contact.id,
    name: user.name,
    phone: user.phone,
    relation: contact.relation,
    sharing: user.shareLive,
    status,
    location: best && { ...best, at: best.at.toISOString() },
    trip: trip
      ? {
          id: trip.id,
          mode: trip.mode,
          status: trip.status,
          destLabel: trip.destLabel,
          dest: trip.destLabel === "SOS alert" ? null : [trip.destLng, trip.destLat],
          expectedArrival: trip.expectedArrival.toISOString(),
          alertReason: trip.alertReason,
          vehicle: [trip.vehicleType, trip.vehiclePlate].filter(Boolean).join(" ") || null,
          startedAt: trip.startedAt.toISOString(),
        }
      : null,
    myResponse,
  };
}

/** Everyone who added this account as a trusted contact, with what they currently share. */
export async function peopleFor(guardianUserId: string): Promise<PersonSummary[]> {
  const db = await getDb();
  const links = await db
    .select({ contact: schema.contacts, user: schema.users })
    .from(schema.contacts)
    .innerJoin(schema.users, eq(schema.users.id, schema.contacts.userId))
    .where(eq(schema.contacts.guardianUserId, guardianUserId));
  if (!links.length) return [];
  const userIds = links.map((l) => l.user.id);
  const trips = await db
    .select()
    .from(schema.trips)
    .where(and(inArray(schema.trips.userId, userIds), inArray(schema.trips.status, ["active", "alert", "sos"])))
    .orderBy(desc(schema.trips.startedAt));
  const responses = trips.length
    ? await db
        .select()
        .from(schema.sosResponses)
        .where(and(inArray(schema.sosResponses.tripId, trips.map((t) => t.id)), inArray(schema.sosResponses.contactId, links.map((l) => l.contact.id))))
    : [];
  const order = { sos: 0, alert: 1, journey: 2, sharing: 3, idle: 4 };
  return links
    .map((l) => {
      const trip = trips.find((t) => t.userId === l.user.id);
      const r = trip && responses.find((x) => x.tripId === trip.id && x.contactId === l.contact.id);
      return summarise(l.contact, l.user, trip, r?.response ?? null);
    })
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}

/** One person this account protects; 404 unless they really added this account. */
export async function personFor(guardianUserId: string, userId: string) {
  const people = await peopleFor(guardianUserId);
  const p = people.find((x) => x.userId === userId);
  if (!p) throw new ApiError(404, "This person hasn't added you as a trusted contact");
  return p;
}
