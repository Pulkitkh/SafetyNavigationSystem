import type { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { cellStats } from "@/lib/providers/cells";
import { checkUpstreams, summarise } from "@/lib/providers/health";
import { olaEnabled } from "@/lib/providers/ola";
import { telegramEnabled, vapidPublicKey, whatsappEnabled } from "@/lib/server/alerts";
import { json, rateLimit, route } from "@/lib/server/http";
import { fcmEnabled } from "@/lib/server/fcm";
import { smsProvider } from "@/lib/server/sms";

export const dynamic = "force-dynamic";

/**
 * Liveness of the database and every public data service. Point an uptime monitor
 * at it: 200 means safe routing works, 503 means a critical service is down.
 * Add ?deep=0 to check only the database.
 */
export const GET = route(async (req: NextRequest) => {
  rateLimit(req, "health", 10, 60_000);
  let database = true;
  try {
    await (await getDb()).execute(sql`select 1`);
  } catch {
    database = false;
  }
  if (req.nextUrl.searchParams.get("deep") === "0") return json({ ok: database, database }, database ? 200 : 503);
  const probes = await checkUpstreams();
  const { ok, services } = summarise(probes);
  const healthy = ok && database;
  // Optional extras are reported but not probed, so health checks don't spend their quotas.
  const on = (v: boolean) => (v ? "configured" : "not configured");
  const optional = {
    "place search (Ola Maps)": on(olaEnabled()),
    "SOS app notifications (Web Push)": on(!!vapidPublicKey() && !!process.env.VAPID_PRIVATE_KEY),
    "SOS alerts on Telegram": on(telegramEnabled()),
    "SOS alerts on WhatsApp": on(whatsappEnabled()),
    "SOS ringing in the app (Firebase)": on(fcmEnabled()),
    "Watchdog kept awake (CRON_SECRET)": on(!!process.env.CRON_SECRET?.trim()),
    "SOS SMS gateway": on(!!smsProvider()),
  };
  // Street data downloaded so far: how much of the map is ready for instant, detailed scoring.
  const streetData = await cellStats().catch(() => null);
  return json({ ok: healthy, database, services, optional, streetData, probes, checkedAt: new Date().toISOString() }, healthy ? 200 : 503);
});
