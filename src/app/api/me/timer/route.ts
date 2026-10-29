import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ApiError, json, parseBody, rateLimit, requireUser, route } from "@/lib/server/http";
import { safetyTimerInput } from "@/lib/server/validation";

/** Longest safety timer the app offers, plus slack. */
const MAX_TIMER_MS = 25 * 3600_000;

/**
 * Mirrors the phone's safety timer on the server, so the SOS still goes out if
 * the phone is switched off or SafeNav is closed when it runs out.
 */
export const PUT = route(async (req: NextRequest) => {
  const user = await requireUser();
  rateLimit(req, "me-timer", 30, 10 * 60_000);
  const { endsAt, note } = await parseBody(req, safetyTimerInput);
  if (endsAt - Date.now() > MAX_TIMER_MS) throw new ApiError(400, "That timer is too long");
  const db = await getDb();
  const values = { endsAt: new Date(endsAt), note: note || null, checkinSentAt: null };
  await db
    .insert(schema.safetyTimers)
    .values({ userId: user.id, ...values })
    .onConflictDoUpdate({ target: schema.safetyTimers.userId, set: values });
  return json({ ok: true });
});

export const DELETE = route(async () => {
  const user = await requireUser();
  const db = await getDb();
  await db.delete(schema.safetyTimers).where(eq(schema.safetyTimers.userId, user.id));
  return json({ ok: true });
});
