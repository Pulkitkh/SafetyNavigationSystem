import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/server/auth";
import { inviteFor } from "@/lib/server/guardian";
import { json, parseBody, rateLimit, route } from "@/lib/server/http";
import { pushSubscriptionInput, unsubscribeInput } from "@/lib/server/validation";

type Ctx = { params: Promise<{ token: string }> };

const MAX_DEVICES = 5;

/** Link this browser/phone to receive the inviter's SOS alerts as notifications. */
export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  rateLimit(req, "guardian-sub", 20, 60 * 60_000);
  const { token } = await params;
  const { contact } = await inviteFor(token);
  const { subscription, label } = await parseBody(req, pushSubscriptionInput);
  const db = await getDb();
  const devices = await db.select().from(schema.guardianDevices).where(eq(schema.guardianDevices.contactId, contact.id));
  const existing = devices.find((d) => d.kind === "push" && d.address === subscription.endpoint);
  if (existing) {
    await db.update(schema.guardianDevices).set({ keys: JSON.stringify(subscription.keys), failures: 0 }).where(eq(schema.guardianDevices.id, existing.id));
    return json({ ok: true, deviceId: existing.id });
  }
  // Keep the newest few devices; an old phone's subscription gives way to a new one.
  const push = devices.filter((d) => d.kind === "push").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (push.length >= MAX_DEVICES) await db.delete(schema.guardianDevices).where(eq(schema.guardianDevices.id, push[0].id));
  const id = newId();
  await db.insert(schema.guardianDevices).values({
    id,
    contactId: contact.id,
    kind: "push",
    address: subscription.endpoint,
    keys: JSON.stringify(subscription.keys),
    label: label ?? null,
  });
  return json({ ok: true, deviceId: id }, 201);
});

export const DELETE = route(async (req: NextRequest, { params }: Ctx) => {
  const { token } = await params;
  const { contact } = await inviteFor(token);
  const { endpoint } = await parseBody(req, unsubscribeInput);
  const db = await getDb();
  await db
    .delete(schema.guardianDevices)
    .where(and(eq(schema.guardianDevices.contactId, contact.id), eq(schema.guardianDevices.kind, "push"), eq(schema.guardianDevices.address, endpoint)));
  return json({ ok: true });
});
