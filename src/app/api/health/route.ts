import type { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { checkUpstreams, summarise } from "@/lib/providers/health";
import { olaEnabled } from "@/lib/providers/ola";
import { json, rateLimit, route } from "@/lib/server/http";

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
    await (await getDb()).run(sql`select 1`);
  } catch {
    database = false;
  }
  if (req.nextUrl.searchParams.get("deep") === "0") return json({ ok: database, database }, database ? 200 : 503);
  const probes = await checkUpstreams();
  const { ok, services } = summarise(probes);
  const healthy = ok && database;
  // Optional extras are reported but not probed, so health checks don't spend their quotas.
  const optional = { "place search (Ola Maps)": olaEnabled() ? "configured" : "not configured" };
  return json({ ok: healthy, database, services, optional, probes, checkedAt: new Date().toISOString() }, healthy ? 200 : 503);
});
