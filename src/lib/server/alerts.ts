/**
 * Automatic alerts to trusted contacts, sent by the server the moment an SOS is
 * raised, with no action needed on the phone in danger:
 *
 * - Web Push to every phone or browser where the contact opened their invite
 *   link and allowed notifications (free; VAPID keys only).
 * - Telegram, when TELEGRAM_BOT_TOKEN is set and the contact started the bot
 *   from their invite link (free).
 *
 * Paid SMS gateways (sms.ts) and the phone's own SMS (native app) run alongside.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import webpush from "web-push";
import { getDb, schema } from "@/lib/db";

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
}

export interface DeliveryResult {
  contactId: string;
  deviceId: string;
  channel: "push" | "telegram";
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

// ---------------------------------------------------------------- Fan-out

/** Alerts every linked device of the given contacts in parallel and records each outcome. */
export async function alertContacts(contactIds: string[], payload: AlertPayload, opts: { record?: boolean } = {}): Promise<DeliveryResult[]> {
  if (!contactIds.length) return [];
  const db = await getDb();
  const devices = await db.select().from(schema.guardianDevices).where(inArray(schema.guardianDevices.contactId, contactIds));
  if (!devices.length) return [];

  const results = await Promise.all(
    devices.map(async (d) => {
      const r = d.kind === "push" ? await sendPush(d, payload) : await sendTelegram(d, payload);
      return { device: d, ...r };
    }),
  );

  const gone = results.filter((r) => r.gone).map((r) => r.device.id);
  if (gone.length) await db.delete(schema.guardianDevices).where(inArray(schema.guardianDevices.id, gone));
  const failed = results.filter((r) => !r.ok && !r.gone).map((r) => r.device.id);
  if (failed.length) {
    await db
      .update(schema.guardianDevices)
      .set({ failures: sql`${schema.guardianDevices.failures} + 1` })
      .where(inArray(schema.guardianDevices.id, failed));
  }
  const okIds = results.filter((r) => r.ok).map((r) => r.device.id);
  if (okIds.length) await db.update(schema.guardianDevices).set({ failures: 0 }).where(inArray(schema.guardianDevices.id, okIds));

  if (opts.record !== false) await db.insert(schema.alertDeliveries).values(
    results.map((r) => ({
      tripId: payload.tripId,
      contactId: r.device.contactId,
      deviceId: r.device.id,
      kind: payload.kind,
      channel: r.device.kind,
      ok: r.ok,
      error: r.error?.slice(0, 200) ?? null,
    })),
  );
  return results.map((r) => ({ contactId: r.device.contactId, deviceId: r.device.id, channel: r.device.kind, ok: r.ok, error: r.error }));
}

/** Marks alerts for a trip as seen by the device that opened its link. */
export async function markSeen(tripId: string, deviceId: string) {
  const db = await getDb();
  await db
    .update(schema.alertDeliveries)
    .set({ seenAt: new Date() })
    .where(and(eq(schema.alertDeliveries.tripId, tripId), eq(schema.alertDeliveries.deviceId, deviceId), sql`${schema.alertDeliveries.seenAt} IS NULL`));
}
