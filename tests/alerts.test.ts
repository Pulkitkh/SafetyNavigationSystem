import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) } }));

import { getDb, resetDbForTests, schema } from "@/lib/db";
import { alertContacts, markSeen, resetAlertsForTests, templateText, validMetaSignature, withDevice } from "@/lib/server/alerts";
import { pushSubscriptionInput } from "@/lib/server/validation";

const realFetch = globalThis.fetch;
const telegramCalls: { method: string; body: Record<string, unknown> }[] = [];
const whatsappCalls: { url: string; auth: string; body: Record<string, unknown> }[] = [];

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), "alerts-")), "t.db")}`;
  process.env.VAPID_PUBLIC_KEY = "BPub";
  process.env.VAPID_PRIVATE_KEY = "priv";
  process.env.TELEGRAM_BOT_TOKEN = "123:abc";
  process.env.WHATSAPP_TOKEN = "wa-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "1098";
  resetDbForTests();
  resetAlertsForTests();
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    if (String(url).startsWith("https://graph.facebook.com/")) {
      const body = JSON.parse(String(init.body));
      whatsappCalls.push({ url: String(url), auth: String((init.headers as Record<string, string>).Authorization), body });
      if (body.to === "919800000009") return new Response(JSON.stringify({ error: { message: "Recipient is not a WhatsApp user", code: 131026 } }), { status: 400 });
      if (body.type === "location") return new Response(JSON.stringify({ error: { message: "Re-engagement message", code: 131047 } }), { status: 400 });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }));
    }
    const method = String(url).split("/").pop()!;
    telegramCalls.push({ method, body: JSON.parse(String(init.body)) });
    const blocked = JSON.parse(String(init.body)).chat_id === "666";
    return new Response(JSON.stringify(blocked ? { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } : { ok: true, result: {} }));
  }) as typeof fetch;
  const db = await getDb();
  await db.insert(schema.users).values({ id: "u1", name: "Asha", email: "a@x.in", passwordHash: "x" });
  await db.insert(schema.contacts).values([
    { id: "c1", userId: "u1", name: "Mum", phone: "+919800000001", relation: "Mother" },
    { id: "c2", userId: "u1", name: "Riya", phone: "+919800000002", relation: "Friend" },
  ]);
  await db.insert(schema.trips).values({
    id: "t1",
    userId: "u1",
    shareTokenHash: "h",
    mode: "walk",
    status: "sos",
    destLabel: "SOS alert",
    destLat: 22.7,
    destLng: 75.8,
    routeJson: "[]",
    expectedArrival: new Date(),
  });
  await db.insert(schema.guardianDevices).values([
    { id: "d-push-ok", contactId: "c1", kind: "push", address: "https://fcm.googleapis.com/fcm/send/ok", keys: '{"p256dh":"p","auth":"a"}' },
    { id: "d-push-gone", contactId: "c1", kind: "push", address: "https://fcm.googleapis.com/fcm/send/gone", keys: '{"p256dh":"p","auth":"a"}' },
    { id: "d-tg", contactId: "c2", kind: "telegram", address: "555" },
    { id: "d-tg-blocked", contactId: "c2", kind: "telegram", address: "666" },
    { id: "d-wa", contactId: "c2", kind: "whatsapp", address: "919800000002" },
    { id: "d-wa-none", contactId: "c1", kind: "whatsapp", address: "919800000009" },
  ]);
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  sendNotification.mockReset();
  telegramCalls.length = 0;
  whatsappCalls.length = 0;
});

describe("automatic SOS alerts", () => {
  it("reaches every linked device at once and records who was reached", async () => {
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith("gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      return { statusCode: 201 };
    });
    const results = await alertContacts(["c1", "c2"], {
      kind: "sos",
      tripId: "t1",
      title: "SOS: Asha needs help",
      body: "Tap to see their live location",
      url: "https://safenav.example/t/tok",
      lat: 22.72,
      lng: 75.86,
    });
    expect(results.filter((r) => r.ok).map((r) => r.deviceId).sort()).toEqual(["d-push-ok", "d-tg", "d-wa"]);

    // WhatsApp goes through Meta's Cloud API with the approved template; the map pin outside the 24 h window is refused quietly.
    const tpl = whatsappCalls.find((c) => c.body.to === "919800000002" && c.body.type === "template")!;
    expect(tpl.url).toBe("https://graph.facebook.com/v21.0/1098/messages");
    expect(tpl.auth).toBe("Bearer wa-token");
    expect(tpl.body).toMatchObject({ messaging_product: "whatsapp", template: { name: "safenav_alert", language: { code: "en" } } });
    const params = (tpl.body.template as { components: { parameters: { text: string }[] }[] }).components[0].parameters.map((p) => p.text);
    expect(params).toEqual(["🚨 SOS: Asha needs help", "Tap to see their live location", "https://safenav.example/t/tok?g=d-wa"]);

    // The push payload links back with the device id so "seen" can be reported.
    const [, payload, opts] = sendNotification.mock.calls.find(([s]) => s.endpoint.endsWith("ok"))!;
    expect(JSON.parse(payload)).toMatchObject({ kind: "sos", url: "https://safenav.example/t/tok?g=d-push-ok" });
    expect(opts).toMatchObject({ urgency: "high" });

    // Telegram gets the message with a live-location button, then a native map pin.
    expect(telegramCalls.filter((c) => c.body.chat_id === "555").map((c) => c.method)).toEqual(["sendMessage", "sendLocation"]);

    // Revoked subscriptions and blocked bots are cleaned up; nothing else is.
    const db = await getDb();
    const left = (await db.select().from(schema.guardianDevices)).map((d) => d.id).sort();
    // A number that isn't on WhatsApp is dropped too.
    expect(left).toEqual(["d-push-ok", "d-tg", "d-wa"]);
    const rows = await db.select().from(schema.alertDeliveries);
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.ok)).toHaveLength(3);
  });

  it("marks an alert seen when the contact opens the link", async () => {
    await markSeen("t1", "d-push-ok");
    const db = await getDb();
    const rows = await db.select().from(schema.alertDeliveries);
    expect(rows.find((r) => r.deviceId === "d-push-ok")!.seenAt).toBeInstanceOf(Date);
    expect(rows.find((r) => r.deviceId === "d-tg")!.seenAt).toBeNull();
  });

  it("does nothing for contacts with no linked devices", async () => {
    expect(await alertContacts([], { kind: "sos", tripId: "t1", title: "x", body: "y", url: null })).toEqual([]);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("only accepts subscriptions from real push services", () => {
    const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
    expect(pushSubscriptionInput.safeParse({ subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys } }).success).toBe(true);
    expect(pushSubscriptionInput.safeParse({ subscription: { endpoint: "https://web.push.apple.com/QH", keys } }).success).toBe(true);
    expect(pushSubscriptionInput.safeParse({ subscription: { endpoint: "https://169.254.169.254/latest", keys } }).success).toBe(false);
    expect(pushSubscriptionInput.safeParse({ subscription: { endpoint: "http://fcm.googleapis.com/x", keys } }).success).toBe(false);
  });

  it("keeps WhatsApp template variables within Meta's rules", () => {
    expect(templateText("Line one\nLine two\twith     gaps")).toBe("Line one Line two with   gaps");
    expect(templateText("")).toBe("-");
    expect(templateText("x".repeat(2000))).toHaveLength(600);
  });

  it("accepts only webhook calls signed with the app secret", () => {
    const body = '{"entry":[]}';
    const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(validMetaSignature(body, sig, "s3cret")).toBe(true);
    expect(validMetaSignature(body, sig, "other")).toBe(false);
    expect(validMetaSignature(body + " ", sig, "s3cret")).toBe(false);
    expect(validMetaSignature(body, null, "s3cret")).toBe(false);
  });

  it("adds the device id to links", () => {
    expect(withDevice("https://a.in/t/x", "d1")).toBe("https://a.in/t/x?g=d1");
    expect(withDevice(null, "d1")).toBeNull();
  });
});
