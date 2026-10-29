import type { NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { json, parseBody, rateLimit, requireUser, route } from "@/lib/server/http";
import { appDeviceInput } from "@/lib/server/validation";

/** The SafeNav app registers its Firebase token so SOS alerts from people you protect ring this phone. */
export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  rateLimit(req, "app-device", 20, 60 * 60_000);
  const { token, platform } = await parseBody(req, appDeviceInput);
  const db = await getDb();
  // A token belongs to one install; if someone else signed in on this phone before, it moves to the current account.
  await db
    .insert(schema.appDevices)
    .values({ token, userId: me.id, platform })
    .onConflictDoUpdate({ target: schema.appDevices.token, set: { userId: me.id, platform, updatedAt: sql`now()` } });
  return json({ ok: true });
});

/** Signing out stops this phone ringing for that account. */
export const DELETE = route(async (req: NextRequest) => {
  const me = await requireUser();
  const { token } = await parseBody(req, appDeviceInput.pick({ token: true }));
  const db = await getDb();
  await db.delete(schema.appDevices).where(and(eq(schema.appDevices.token, token), eq(schema.appDevices.userId, me.id)));
  return json({ ok: true });
});
