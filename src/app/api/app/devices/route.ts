import type { NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { json, parseBody, rateLimit, requireUser, route } from "@/lib/server/http";
import { appDeviceInput, appDeviceRemoveInput } from "@/lib/server/validation";

/**
 * The SafeNav app registers where this account gets alerts (SOS from people you
 * protect, and your own check-ins): the Android app's Firebase token, or the
 * installed web app's push subscription.
 */
export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  rateLimit(req, "app-device", 30, 60 * 60_000);
  const input = await parseBody(req, appDeviceInput);
  const keys = input.platform === "web" ? JSON.stringify(input.keys) : null;
  const db = await getDb();
  // A token belongs to one install; if someone else signed in on this phone before, it moves to the current account.
  await db
    .insert(schema.appDevices)
    .values({ token: input.token, userId: me.id, platform: input.platform, keys })
    .onConflictDoUpdate({ target: schema.appDevices.token, set: { userId: me.id, platform: input.platform, keys, updatedAt: sql`now()` } });
  return json({ ok: true });
});

/** Signing out stops this phone ringing for that account. */
export const DELETE = route(async (req: NextRequest) => {
  const me = await requireUser();
  const { token } = await parseBody(req, appDeviceRemoveInput);
  const db = await getDb();
  await db.delete(schema.appDevices).where(and(eq(schema.appDevices.token, token), eq(schema.appDevices.userId, me.id)));
  return json({ ok: true });
});
