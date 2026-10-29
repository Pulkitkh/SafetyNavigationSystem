/**
 * Automatic alerts to trusted contacts, sent by the server the moment an SOS is
 * raised, with no action needed on the phone in danger:
 *
 * - Web Push to every phone or browser where the contact opened their invite
 *   link and allowed notifications (free; VAPID keys only).
 * - Telegram, when TELEGRAM_BOT_TOKEN is set and the contact started the bot
 *   from their invite link (free).
 * - WhatsApp, through Meta's official WhatsApp Cloud API, when WHATSAPP_TOKEN
 *   and WHATSAPP_PHONE_NUMBER_ID are set and the contact opted in from their
 *   invite link. Business-initiated messages must use a template Meta has
 *   approved, and Meta bills each one (about ₹0.12 for a utility message in India).
 *
 * Paid SMS gateways (sms.ts) and the phone's own SMS (native app) run alongside.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import webpush from "web-push";
import { getDb, schema } from "@/lib/db";
import { sendFcm } from "./fcm";

export type AlertKind = "sos" | "safe" | "journey" | "test";

export interface AlertPayload {
  kind: AlertKind;
  tripId: string;
  title: string;
  body: string;
  /** Live-tracking page; each device's link carries its id so we can tell the sender it was opened. */
  url: string | null;
  lat?: number | null;
  lng?: number | null;
  /** The person the alert is about; the SafeNav app opens their page under People. */
  personUserId?: string;
}

export interface DeliveryResult {
  contactId: string;
  deviceId: string;
  channel: "push" | "telegram" | "whatsapp" | "fcm";
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------- Web Push

let vapidReady: boolean | null = null;

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

function pushEnabled(): boolean {
  if (vapidReady != null) return vapidReady;
  const pub = vapidPublicKey();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  vapidReady = false;
  if (pub && priv) {
    try {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT?.trim() || `mailto:${process.env.OSM_CONTACT_EMAIL || "alerts@safenav.app"}`, pub, priv);
      vapidReady = true;
    } catch (err) {
      console.error(`[alerts] VAPID keys are invalid: ${(err as Error).message}`);
    }
  }
  return vapidReady;
}

export function resetAlertsForTests() {
  vapidReady = null;
  botName = undefined;
}

/** Appends the device id, so opening the link marks this alert as seen. */
export function withDevice(url: string | null, deviceId: string) {
  if (!url) return null;
  return `${url}${url.includes("?") ? "&" : "?"}g=${encodeURIComponent(deviceId)}`;
}

async function sendPush(device: typeof schema.guardianDevices.$inferSelect, p: AlertPayload): Promise<{ ok: boolean; gone?: boolean; error?: string }> {
  if (!pushEnabled()) return { ok: false, error: "push not configured" };
  try {
    const keys = JSON.parse(device.keys ?? "{}") as { p256dh?: string; auth?: string };
    await webpush.sendNotification(
      { endpoint: device.address, keys: { p256dh: keys.p256dh ?? "", auth: keys.auth ?? "" } },
      JSON.stringify({ kind: p.kind, title: p.title, body: p.body, url: withDevice(p.url, device.id), tag: `${p.kind}-${p.tripId}` }),
      // SOS is time-critical: deliver now and don't hold it for later than an hour.
      { TTL: p.kind === "journey" ? 4 * 3600 : 3600, urgency: p.kind === "journey" ? "normal" : "high", timeout: 10_000 },
    );
    return { ok: true };
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    // 404/410: the contact uninstalled the app or revoked notifications.
    return { ok: false, gone: status === 404 || status === 410, error: status ? `push service HTTP ${status}` : (err as Error).message };
  }
}

// ---------------------------------------------------------------- Telegram

export function telegramEnabled() {
  return !!process.env.TELEGRAM_BOT_TOKEN?.trim();
}

async function telegram<T = unknown>(method: string, body: unknown): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN!.trim()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number };
  if (!data.ok) {
    const err = new Error(`Telegram ${method}: ${data.description ?? `HTTP ${res.status}`}`) as Error & { code?: number };
    err.code = data.error_code ?? res.status;
    throw err;
  }
  return data.result as T;
}

export function telegramMessage(chatId: string, text: string, button?: { text: string; url: string }) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(button ? { reply_markup: { inline_keyboard: [[button]] } } : {}),
  });
}

let botName: string | null | undefined;

/** The bot's @username, for t.me invite links. */
export async function telegramBotName(): Promise<string | null> {
  if (!telegramEnabled()) return null;
  if (botName !== undefined) return botName;
  try {
    botName = (await telegram<{ username: string }>("getMe", {})).username;
  } catch (err) {
    console.warn(`[alerts] ${(err as Error).message}`);
    return null; // retry next time
  }
  return botName;
}

/** Secret Telegram must echo back on webhook calls, so nobody else can post fake updates. */
export function telegramWebhookSecret(): string {
  const configured = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (configured) return configured;
  // Derived from the bot token so no extra setting is needed.
  return createHash("sha256").update(`webhook:${process.env.TELEGRAM_BOT_TOKEN ?? ""}`).digest("hex").slice(0, 48);
}

let webhookSet = false;

/** Points the bot at our webhook. Idempotent; called when the first invite page is opened. */
export async function ensureTelegramWebhook(baseUrl: string) {
  if (!telegramEnabled() || webhookSet || !baseUrl.startsWith("https://")) return;
  try {
    await telegram("setWebhook", { url: `${baseUrl}/api/telegram/webhook`, secret_token: telegramWebhookSecret(), allowed_updates: ["message"] });
    webhookSet = true;
  } catch (err) {
    console.warn(`[alerts] ${(err as Error).message}`);
  }
}

async function sendTelegram(device: typeof schema.guardianDevices.$inferSelect, p: AlertPayload): Promise<{ ok: boolean; gone?: boolean; error?: string }> {
  if (!telegramEnabled()) return { ok: false, error: "Telegram not configured" };
  try {
    const url = withDevice(p.url, device.id);
    await telegramMessage(device.address, `${p.title}\n\n${p.body}`, url ? { text: p.kind === "safe" ? "See their trip" : "Open live location", url } : undefined);
    // A native location pin opens straight into the contact's map app.
    if (p.kind === "sos" && p.lat != null && p.lng != null) {
      await telegram("sendLocation", { chat_id: device.address, latitude: p.lat, longitude: p.lng }).catch(() => {});
    }
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: number }).code;
    // 403: the contact blocked the bot.
    return { ok: false, gone: code === 403, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------- WhatsApp

export function whatsappEnabled() {
  return !!process.env.WHATSAPP_TOKEN?.trim() && !!process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
}

/** WhatsApp template variables can't contain newlines, tabs or long runs of spaces. */
export function templateText(v: string, max = 600) {
  return v.replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, max) || "-";
}

const HEADLINE: Record<AlertKind, (title: string) => string> = {
  sos: (t) => `🚨 ${t}`,
  safe: (t) => `✅ ${t}`,
  journey: (t) => t,
  test: (t) => t,
};

async function whatsapp(body: unknown): Promise<void> {
  const version = process.env.WHATSAPP_API_VERSION?.trim() || "v21.0";
  const res = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID!.trim()}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN!.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...(body as object) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return;
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
  const err = new Error(`WhatsApp: ${data.error?.message ?? `HTTP ${res.status}`}`) as Error & { code?: number };
  err.code = data.error?.code;
  throw err;
}

/** Meta signs webhook calls with the app secret: X-Hub-Signature-256: sha256=<hex HMAC of the raw body>. */
export function validMetaSignature(raw: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const given = header.slice(7);
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Free-form text: only allowed within 24 hours of the contact messaging the business number. */
export function whatsappText(to: string, text: string) {
  return whatsapp({ to, type: "text", text: { body: text, preview_url: true } });
}

/**
 * One approved template carries every kind of alert (see docs/WHATSAPP.md):
 * {{1}} headline, {{2}} details, {{3}} link to open.
 */
async function sendWhatsApp(device: typeof schema.guardianDevices.$inferSelect, p: AlertPayload): Promise<{ ok: boolean; gone?: boolean; error?: string }> {
  if (!whatsappEnabled()) return { ok: false, error: "WhatsApp not configured" };
  const link =
    withDevice(p.url, device.id) ??
    (p.lat != null && p.lng != null ? `https://maps.google.com/?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}` : process.env.APP_URL?.trim() || "the SafeNav app");
  try {
    await whatsapp({
      to: device.address.replace(/\D/g, ""),
      type: "template",
      template: {
        name: process.env.WHATSAPP_TEMPLATE?.trim() || "safenav_alert",
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG?.trim() || "en" },
        components: [
          {
            type: "body",
            parameters: [HEADLINE[p.kind](p.title), p.body, link].map((t) => ({ type: "text", text: templateText(t) })),
          },
        ],
      },
    });
    // A map pin is only allowed inside the 24-hour window; outside it this is refused, which is fine.
    if (p.kind === "sos" && p.lat != null && p.lng != null) {
      await whatsapp({ to: device.address.replace(/\D/g, ""), type: "location", location: { latitude: p.lat, longitude: p.lng, name: "Last known location" } }).catch(() => {});
    }
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: number }).code;
    // 131026: the number isn't on WhatsApp or can't receive messages, so stop trying it.
    return { ok: false, gone: code === 131026, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------- Fan-out

/** Alerts every linked device of the given contacts in parallel and records each outcome. */
type Channel = DeliveryResult["channel"];

/** Rings a SafeNav app install with a data message; the app shows the alert itself (full screen for SOS). */
async function sendApp(token: string, p: AlertPayload) {
  const base = process.env.APP_URL?.replace(/\/+$/, "") ?? "";
  return sendFcm(token, {
    kind: p.kind,
    title: p.title,
    body: p.body,
    tripId: p.tripId,
    url: p.personUserId ? `${base}/people/${p.personUserId}` : (p.url ?? base),
    ...(p.personUserId ? { personUserId: p.personUserId } : {}),
    ...(p.lat != null && p.lng != null ? { lat: String(p.lat), lng: String(p.lng) } : {}),
  });
}

/**
 * Alerts every linked device of the given contacts in parallel and records each
 * outcome. Contacts who linked their SafeNav account also get their app rung.
 */
export async function alertContacts(
  contactIds: string[],
  payload: AlertPayload,
  opts: { record?: boolean; channels?: Channel[] } = {},
): Promise<DeliveryResult[]> {
  if (!contactIds.length) return [];
  const db = await getDb();
  const wanted = (c: Channel) => !opts.channels || opts.channels.includes(c);
  const devices = (await db.select().from(schema.guardianDevices).where(inArray(schema.guardianDevices.contactId, contactIds))).filter((d) => wanted(d.kind));
  const linked = wanted("fcm")
    ? await db
        .select({ contactId: schema.contacts.id, userId: schema.contacts.guardianUserId })
        .from(schema.contacts)
        .where(and(inArray(schema.contacts.id, contactIds), isNotNull(schema.contacts.guardianUserId)))
    : [];
  const apps = linked.length
    ? await db
        .select()
        .from(schema.appDevices)
        .where(inArray(schema.appDevices.userId, linked.map((l) => l.userId!)))
    : [];
  if (!devices.length && !apps.length) return [];

  const [results, appResults] = await Promise.all([
    Promise.all(
      devices.map(async (d) => {
        const r = d.kind === "push" ? await sendPush(d, payload) : d.kind === "whatsapp" ? await sendWhatsApp(d, payload) : await sendTelegram(d, payload);
        return { device: d, ...r };
      }),
    ),
    Promise.all(
      apps.flatMap((a) =>
        linked
          .filter((l) => l.userId === a.userId)
          .map(async (l) => ({ app: a, contactId: l.contactId, deviceId: `app:${createHash("sha256").update(a.token).digest("hex").slice(0, 16)}`, ...(await sendApp(a.token, payload)) })),
      ),
    ),
  ]);

  const gone = results.filter((r) => r.gone).map((r) => r.device.id);
  if (gone.length) await db.delete(schema.guardianDevices).where(inArray(schema.guardianDevices.id, gone));
  const goneApps = appResults.filter((r) => r.gone).map((r) => r.app.token);
  if (goneApps.length) await db.delete(schema.appDevices).where(inArray(schema.appDevices.token, goneApps));
  const failed = results.filter((r) => !r.ok && !r.gone).map((r) => r.device.id);
  if (failed.length) {
    await db
      .update(schema.guardianDevices)
      .set({ failures: sql`${schema.guardianDevices.failures} + 1` })
      .where(inArray(schema.guardianDevices.id, failed));
  }
  const okIds = results.filter((r) => r.ok).map((r) => r.device.id);
  if (okIds.length) await db.update(schema.guardianDevices).set({ failures: 0 }).where(inArray(schema.guardianDevices.id, okIds));

  const all: DeliveryResult[] = [
    ...results.map((r) => ({ contactId: r.device.contactId, deviceId: r.device.id, channel: r.device.kind, ok: r.ok, error: r.error })),
    ...appResults.map((r) => ({ contactId: r.contactId, deviceId: r.deviceId, channel: "fcm" as const, ok: r.ok, error: r.error })),
  ];
  if (opts.record !== false && all.length) {
    await db.insert(schema.alertDeliveries).values(
      all.map((r) => ({
        tripId: payload.tripId,
        contactId: r.contactId,
        deviceId: r.deviceId,
        kind: payload.kind,
        channel: r.channel,
        ok: r.ok,
        error: r.error?.slice(0, 200) ?? null,
      })),
    );
  }
  return all;
}

/** Re-alert schedule for an SOS nobody has opened yet (seconds after the first alert). */
export const REALERT_AFTER_S = [45, 90, 180];

/**
 * Keeps ringing contacts who haven't opened the SOS or answered it, while it
 * is still open. Only free channels repeat (app ring and browser push), never
 * paid WhatsApp messages. Runs in this server process; a restart drops pending
 * repeats, which is acceptable because the first alert already went out.
 */
export function repeatSosAlerts(contactIds: string[], payload: AlertPayload, schedule = REALERT_AFTER_S) {
  for (const s of schedule) {
    const t = setTimeout(() => {
      void (async () => {
        const db = await getDb();
        const trip = await db.query.trips.findFirst({ where: eq(schema.trips.id, payload.tripId), columns: { status: true } });
        if (trip?.status !== "sos") return;
        const seen = await db
          .selectDistinct({ contactId: schema.alertDeliveries.contactId })
          .from(schema.alertDeliveries)
          .where(and(eq(schema.alertDeliveries.tripId, payload.tripId), isNotNull(schema.alertDeliveries.seenAt)));
        const answered = await db.select({ contactId: schema.sosResponses.contactId }).from(schema.sosResponses).where(eq(schema.sosResponses.tripId, payload.tripId));
        const done = new Set([...seen.map((r) => r.contactId), ...answered.map((r) => r.contactId)]);
        const pending = contactIds.filter((c) => !done.has(c));
        if (pending.length) await alertContacts(pending, { ...payload, body: `Still no answer. ${payload.body}` }, { record: false, channels: ["push", "fcm"] });
      })().catch((err) => console.error(`[alerts] repeat: ${(err as Error).message}`));
    }, s * 1000);
    t.unref?.();
  }
}

/** Marks every alert to a contact for this trip as seen, e.g. when they open it in the app. */
export async function markSeenByContact(tripId: string, contactId: string) {
  const db = await getDb();
  await db
    .update(schema.alertDeliveries)
    .set({ seenAt: new Date() })
    .where(and(eq(schema.alertDeliveries.tripId, tripId), eq(schema.alertDeliveries.contactId, contactId), sql`${schema.alertDeliveries.seenAt} IS NULL`));
}

/** Marks alerts for a trip as seen by the device that opened its link. */
export async function markSeen(tripId: string, deviceId: string) {
  const db = await getDb();
  await db
    .update(schema.alertDeliveries)
    .set({ seenAt: new Date() })
    .where(and(eq(schema.alertDeliveries.tripId, tripId), eq(schema.alertDeliveries.deviceId, deviceId), sql`${schema.alertDeliveries.seenAt} IS NULL`));
}
