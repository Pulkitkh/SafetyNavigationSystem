import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { ApiError, json, route } from "@/lib/server/http";
import { runWatchdog } from "@/lib/server/watchdog";

/**
 * Runs one watchdog pass. Called every minute by a scheduler outside this
 * server (docs/BACKGROUND_ALERTS.md), which also keeps a free Render server
 * from sleeping, since a sleeping server can't send alerts.
 */
export const POST = route(async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET?.trim();
  const given = req.headers.get("x-cron-secret") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) throw new ApiError(401, "Not allowed");
  await runWatchdog();
  return json({ ok: true });
});
