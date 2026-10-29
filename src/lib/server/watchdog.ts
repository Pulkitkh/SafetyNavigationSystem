/**
 * Server watchdog: looks after people whose phone can't, because it is
 * switched off, out of battery or signal, or has SafeNav closed in the
 * background (a browser can't run the app's own checks then).
 *
 * Every pass, each step is claimed with a conditional UPDATE/DELETE, so it
 * happens once even when two passes overlap (the in-process timer and the
 * external cron that also keeps a sleeping free server awake).
 *
 * Journeys:
 *  1. No location for NUDGE_AFTER_MS: "Open SafeNav so your contacts can keep
 *     following you", to the user's own phone.
 *  2. No location for LOST_AFTER_MS: contacts are told SafeNav lost touch, with
 *     the last known location.
 *  3. Overdue past the app's own grace: "Are you OK?" to the user's own phone;
 *     unanswered after CHECKIN_REPLY_MS, an SOS (Automatic SOS on) or an
 *     overdue warning to contacts (off).
 * Safety timers:
 *  4. When it runs out, "Are you OK?" to the user's own phone; unanswered
 *     past the app's check-in time plus SERVER_SLACK_MS, an SOS.
 */
import { and, eq, gt, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { CHECKIN_TIMEOUT_S, MONITOR_CONFIG } from "@/lib/monitor";
import { alertContacts, alertSelf, baseUrl } from "./alerts";
import type { User } from "./auth";
import { raiseSos, serverShareToken } from "./sos";
import { TRIP_MAX_MS, type Trip } from "./trips";

export const NUDGE_AFTER_MS = 4 * 60_000;
export const LOST_AFTER_MS = 15 * 60_000;
/** How long the user has to answer the server's "Are you OK?" before it escalates. */
export const CHECKIN_REPLY_MS = 5 * 60_000;
/** Lets the phone's own check-in go first, which can also send SMS from the SIM. */
export const SERVER_SLACK_MS = 90_000;
/** Extra wait past the app's overdue grace before the server asks. */
const OVERDUE_EXTRA_MS = 5 * 60_000;

const OPEN = ["active", "alert"] as const;

function clock(d: Date) {
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: process.env.APP_TIMEZONE?.trim() || "Asia/Kolkata" });
}

async function contactIds(userId: string) {
  const db = await getDb();
  return (await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.userId, userId))).map((c) => c.id);
}

async function userById(id: string): Promise<User | undefined> {
  const db = await getDb();
  return db.query.users.findFirst({ where: eq(schema.users.id, id) });
}

/** Claims one watchdog step on a trip: sets the column if it is still empty, and says whether this pass won. */
async function claim(tripId: string, column: "nudgedAt" | "lostNotifiedAt" | "checkinSentAt" | "overdueAlertedAt", now: Date) {
  const db = await getDb();
  const col = schema.trips[column];
  const rows = await db
    .update(schema.trips)
    .set({ [column]: now })
    .where(and(eq(schema.trips.id, tripId), isNull(col), inArray(schema.trips.status, [...OPEN])))
    .returning({ id: schema.trips.id });
  return rows.length > 0;
}

async function journeyLink(trip: Trip) {
  return `${baseUrl()}/t/${await serverShareToken(trip)}`;
}

async function checkJourneys(now: Date) {
  const db = await getDb();
  const t = now.getTime();
  const trips = await db
    .select()
    .from(schema.trips)
    .where(and(inArray(schema.trips.status, [...OPEN]), gt(schema.trips.startedAt, new Date(t - TRIP_MAX_MS))));

  for (const trip of trips) {
    const lastHeard = (trip.lastSeenAt ?? trip.startedAt).getTime();
    const quietMs = t - lastHeard;
    const dest = trip.destLabel;

    // 3. Overdue: ask the user, then escalate.
    const overdueAt = trip.expectedArrival.getTime() + MONITOR_CONFIG[trip.mode].overdueGraceMs + OVERDUE_EXTRA_MS;
    if (t >= overdueAt && !trip.checkinSentAt && (await claim(trip.id, "checkinSentAt", now))) {
      await alertSelf(trip.userId, {
        kind: "checkin",
        tripId: trip.id,
        title: "Are you OK?",
        body: `You were expected at ${dest} by ${clock(trip.expectedArrival)}. Open SafeNav and tap I'm OK or End journey, or your contacts will be alerted in ${CHECKIN_REPLY_MS / 60_000} minutes.`,
        url: `${baseUrl()}/journey`,
      });
      continue;
    }
    if (trip.checkinSentAt && t - trip.checkinSentAt.getTime() >= CHECKIN_REPLY_MS && !trip.overdueAlertedAt && (await claim(trip.id, "overdueAlertedAt", now))) {
      const user = await userById(trip.userId);
      if (!user) continue;
      if (user.autoSos) {
        await raiseSos({ user, trigger: "missed_checkin", reason: `didn't arrive at ${dest} and didn't answer a check-in`, tripId: trip.id, base: baseUrl() });
      } else {
        await alertContacts(await contactIds(user.id), {
          kind: "warning",
          tripId: trip.id,
          personUserId: user.id,
          title: `${user.name} hasn't arrived yet`,
          body: `${user.name} was expected at ${dest} by ${clock(trip.expectedArrival)} and hasn't answered a check-in. Call them to make sure they're OK.`,
          url: await journeyLink(trip),
          lat: trip.lastLat,
          lng: trip.lastLng,
        });
      }
      continue;
    }

    // 1. Quiet phone: nudge the user to reopen SafeNav.
    if (quietMs >= NUDGE_AFTER_MS && !trip.nudgedAt && (await claim(trip.id, "nudgedAt", now))) {
      await alertSelf(trip.userId, {
        kind: "checkin",
        tripId: trip.id,
        title: "Your journey isn't being shared",
        body: `SafeNav hasn't had your location for ${Math.round(quietMs / 60_000)} minutes. Open SafeNav so your contacts can keep following you to ${dest}.`,
        url: `${baseUrl()}/journey`,
      });
    }

    // 2. Still quiet: tell the contacts.
    if (quietMs >= LOST_AFTER_MS && !trip.lostNotifiedAt && (await claim(trip.id, "lostNotifiedAt", now))) {
      const user = await userById(trip.userId);
      if (!user) continue;
      await alertContacts(await contactIds(user.id), {
        kind: "warning",
        tripId: trip.id,
        personUserId: user.id,
        title: `Lost touch with ${user.name}`,
        body: `${user.name}'s phone stopped sharing their location at ${clock(new Date(lastHeard))}, on their way to ${dest}. It may be switched off, out of battery or signal. ${trip.lastLat != null ? "Tap to see where they were last. " : ""}Call them to check they're OK.`,
        url: await journeyLink(trip),
        lat: trip.lastLat,
        lng: trip.lastLng,
      });
    }
  }
}

async function checkTimers(now: Date) {
  const db = await getDb();
  const t = now.getTime();

  // 4a. Timer ran out: ask the user.
  const asked = await db
    .update(schema.safetyTimers)
    .set({ checkinSentAt: now })
    .where(and(lt(schema.safetyTimers.endsAt, now), isNull(schema.safetyTimers.checkinSentAt)))
    .returning();
  for (const timer of asked) {
    await alertSelf(timer.userId, {
      kind: "checkin",
      tripId: `timer-${timer.userId}`,
      title: "Safety timer: are you OK?",
      body: `Your safety timer${timer.note ? ` (${timer.note})` : ""} has run out. Open SafeNav and tap I'm safe, or your contacts get an SOS in about ${Math.ceil((CHECKIN_TIMEOUT_S * 1000 + SERVER_SLACK_MS) / 60_000)} minutes.`,
      url: `${baseUrl()}/timer`,
    });
  }

  // 4b. Nobody answered: SOS.
  const due = await db
    .delete(schema.safetyTimers)
    .where(lt(schema.safetyTimers.endsAt, new Date(t - CHECKIN_TIMEOUT_S * 1000 - SERVER_SLACK_MS)))
    .returning();
  for (const timer of due) {
    const user = await userById(timer.userId);
    if (!user) continue;
    const open = await db.query.trips.findFirst({
      where: and(eq(schema.trips.userId, user.id), inArray(schema.trips.status, ["active", "alert", "sos"])),
      columns: { id: true, status: true },
    });
    if (open?.status === "sos") continue; // already raised
    await raiseSos({
      user,
      trigger: "missed_checkin",
      reason: timer.note ? `safety timer ran out (${timer.note})` : "safety timer ran out",
      tripId: open?.id,
      base: baseUrl(),
    });
  }
}

/** One watchdog pass. Exported for tests and the cron endpoint. */
export async function runWatchdog(now = new Date()) {
  await checkTimers(now);
  await checkJourneys(now);
}

/** When a quiet phone reports again: reset the watchdog, and tell contacts who were warned that it's back. */
export async function backInTouch(trip: Trip, user: Pick<User, "id" | "name">) {
  if (!trip.nudgedAt && !trip.lostNotifiedAt) return;
  const db = await getDb();
  const won = await db
    .update(schema.trips)
    .set({ nudgedAt: null, lostNotifiedAt: null })
    .where(and(eq(schema.trips.id, trip.id), isNotNull(schema.trips.lostNotifiedAt)))
    .returning({ id: schema.trips.id });
  if (!won.length) {
    await db.update(schema.trips).set({ nudgedAt: null }).where(eq(schema.trips.id, trip.id));
    return;
  }
  await alertContacts(await contactIds(user.id), {
    kind: "journey",
    tripId: trip.id,
    personUserId: user.id,
    title: `${user.name} is sharing again`,
    body: `${user.name}'s phone is sending their location again, on their way to ${trip.destLabel}.`,
    url: await journeyLink(trip),
  });
}

let started = false;

/** Starts the in-process watchdog once per server. */
export function startWatchdog(everyMs = 30_000) {
  if (started) return;
  started = true;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    runWatchdog()
      .catch((err) => console.error(`[watchdog] ${(err as Error).message}`))
      .finally(() => {
        running = false;
      });
  };
  const id = setInterval(tick, everyMs);
  id.unref?.();
  setTimeout(tick, 5_000).unref?.();
}
