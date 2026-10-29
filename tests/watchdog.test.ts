import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) } }));

import { getDb, resetDbForTests, schema } from "@/lib/db";
import { CHECKIN_TIMEOUT_S } from "@/lib/monitor";
import { resetAlertsForTests } from "@/lib/server/alerts";
import { backInTouch, CHECKIN_REPLY_MS, LOST_AFTER_MS, runWatchdog, SERVER_SLACK_MS } from "@/lib/server/watchdog";

const KEYS = '{"p256dh":"p","auth":"a"}';

/** Pushes sent since the last reset, as [endpoint, payload]. */
function sent() {
  return sendNotification.mock.calls.map(([sub, body]) => [(sub as { endpoint: string }).endpoint, JSON.parse(String(body))] as const);
}

async function person(id: string, autoSos = true) {
  const db = await getDb();
  await db.insert(schema.users).values({ id, name: `Asha ${id}`, email: `${id}@x.in`, passwordHash: "x", autoSos });
  await db.insert(schema.contacts).values({ id: `${id}-c`, userId: id, name: "Mum", phone: "+919800000001", relation: "Mother" });
  await db.insert(schema.guardianDevices).values({ id: `${id}-d`, contactId: `${id}-c`, kind: "push", address: `https://fcm.googleapis.com/fcm/send/${id}-mum`, keys: KEYS });
  // The user's own phone, with the installed web app's notifications on.
  await db.insert(schema.appDevices).values({ token: `https://fcm.googleapis.com/fcm/send/${id}-self`, userId: id, platform: "web", keys: KEYS });
}

async function trip(id: string, userId: string, o: { startedAgoMs: number; seenAgoMs: number; dueInMs: number }, now: number) {
  const db = await getDb();
  await db.insert(schema.trips).values({
    id,
    userId,
    shareTokenHash: `hash-${id}`,
    mode: "walk",
    status: "active",
    destLabel: "Vijay Nagar",
    destLat: 22.75,
    destLng: 75.89,
    routeJson: "[]",
    expectedArrival: new Date(now + o.dueInMs),
    lastLat: 22.72,
    lastLng: 75.86,
    lastSeenAt: new Date(now - o.seenAgoMs),
    startedAt: new Date(now - o.startedAgoMs),
  });
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), "watchdog-")), "t.db")}`;
  process.env.VAPID_PUBLIC_KEY = "BPub";
  process.env.VAPID_PRIVATE_KEY = "priv";
  process.env.APP_URL = "https://safenav.test";
  resetDbForTests();
  resetAlertsForTests();
  await getDb();
});

beforeEach(() => {
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({});
});

describe("safety timer on the server", () => {
  it("asks the user once when it runs out, then raises the SOS if nobody answers", async () => {
    await person("t");
    const db = await getDb();
    const now = Date.now();
    await db.insert(schema.safetyTimers).values({ userId: "t", endsAt: new Date(now - 5_000), note: "cab home" });

    await runWatchdog(new Date(now));
    await runWatchdog(new Date(now)); // a second, overlapping pass doesn't ask again
    expect(sent()).toEqual([["https://fcm.googleapis.com/fcm/send/t-self", expect.objectContaining({ kind: "checkin", url: "https://safenav.test/timer" })]]);

    sendNotification.mockClear();
    await runWatchdog(new Date(now + CHECKIN_TIMEOUT_S * 1000 + SERVER_SLACK_MS));
    const sos = sent().filter(([, p]) => p.kind === "sos");
    expect(sos.map(([e]) => e)).toEqual(["https://fcm.googleapis.com/fcm/send/t-mum"]);
    expect(sos[0][1].body).toContain("safety timer ran out (cab home)");
    // The link carries a token the server made, which opens the live page.
    expect(sos[0][1].url).toMatch(/^https:\/\/safenav\.test\/t\/[A-Za-z0-9_-]{22,}\?g=t-d$/);
    expect(await db.select().from(schema.safetyTimers).where(eq(schema.safetyTimers.userId, "t"))).toEqual([]);
    const [raised] = await db.select().from(schema.trips).where(eq(schema.trips.userId, "t"));
    expect(raised.status).toBe("sos");
  });
});

describe("journey with a quiet phone", () => {
  it("nudges the user, then tells contacts it lost touch, then that the phone is back", async () => {
    await person("q");
    const now = Date.now();
    await trip("trip-q", "q", { startedAgoMs: LOST_AFTER_MS + 60_000, seenAgoMs: LOST_AFTER_MS + 60_000, dueInMs: 3600_000 }, now);

    await runWatchdog(new Date(now));
    await runWatchdog(new Date(now));
    const kinds = sent().map(([e, p]) => [e.split("/").pop(), p.kind]);
    expect(kinds).toEqual([
      ["q-self", "checkin"],
      ["q-mum", "warning"],
    ]);
    expect(sent()[1][1].title).toBe("Lost touch with Asha q");

    sendNotification.mockClear();
    const db = await getDb();
    const t = (await db.query.trips.findFirst({ where: eq(schema.trips.id, "trip-q") }))!;
    await backInTouch(t, { id: "q", name: "Asha q" });
    expect(sent().map(([, p]) => p.title)).toEqual(["Asha q is sharing again"]);
    const after = (await db.query.trips.findFirst({ where: eq(schema.trips.id, "trip-q") }))!;
    expect([after.nudgedAt, after.lostNotifiedAt]).toEqual([null, null]);
    await db.update(schema.trips).set({ status: "ended" }).where(eq(schema.trips.id, "trip-q"));
  });
});

describe("overdue journey", () => {
  it("asks the user, then raises the SOS when Automatic SOS is on", async () => {
    await person("o");
    const now = Date.now();
    await trip("trip-o", "o", { startedAgoMs: 3600_000, seenAgoMs: 10_000, dueInMs: -40 * 60_000 }, now);

    await runWatchdog(new Date(now));
    expect(sent().map(([e, p]) => [e.split("/").pop(), p.kind])).toEqual([["o-self", "checkin"]]);

    sendNotification.mockClear();
    await runWatchdog(new Date(now + CHECKIN_REPLY_MS));
    expect(sent().map(([e, p]) => [e.split("/").pop(), p.kind])).toContainEqual(["o-mum", "sos"]);
    const db = await getDb();
    expect((await db.query.trips.findFirst({ where: eq(schema.trips.id, "trip-o") }))!.status).toBe("sos");
  });

  it("only warns contacts when Automatic SOS is off", async () => {
    await person("w", false);
    const now = Date.now();
    await trip("trip-w", "w", { startedAgoMs: 3600_000, seenAgoMs: 10_000, dueInMs: -40 * 60_000 }, now);
    await runWatchdog(new Date(now));
    sendNotification.mockClear();
    await runWatchdog(new Date(now + CHECKIN_REPLY_MS));
    expect(sent().map(([e, p]) => [e.split("/").pop(), p.kind, p.title])).toEqual([["w-mum", "warning", "Asha w hasn't arrived yet"]]);
    const db = await getDb();
    expect((await db.query.trips.findFirst({ where: eq(schema.trips.id, "trip-w") }))!.status).toBe("active");
  });
});
