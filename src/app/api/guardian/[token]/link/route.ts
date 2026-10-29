import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { inviteFor } from "@/lib/server/guardian";
import { ApiError, json, rateLimit, requireUser, route } from "@/lib/server/http";

type Ctx = { params: Promise<{ token: string }> };

/**
 * Links the invited contact to the SafeNav account that opened the invite, so
 * they see this person under People: live location (when shared), journeys and
 * SOS. Holding the invite link is the proof; a phone number alone isn't enough.
 */
export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  const me = await requireUser();
  rateLimit(req, "guardian-link", 20, 60 * 60_000);
  const { token } = await params;
  const { contact, userName } = await inviteFor(token);
  if (contact.userId === me.id) throw new ApiError(400, "This is your own invite link. Send it to your contact.");
  if (contact.guardianUserId && contact.guardianUserId !== me.id) throw new ApiError(409, `${userName} already linked this contact to another account. Ask them for a new invite.`);
  const db = await getDb();
  await db.update(schema.contacts).set({ guardianUserId: me.id }).where(eq(schema.contacts.id, contact.id));
  return json({ ok: true, userId: contact.userId, name: userName });
});

export const DELETE = route(async (_req: NextRequest, { params }: Ctx) => {
  const me = await requireUser();
  const { token } = await params;
  const { contact } = await inviteFor(token);
  if (contact.guardianUserId !== me.id) throw new ApiError(404, "Not linked to your account");
  const db = await getDb();
  await db.update(schema.contacts).set({ guardianUserId: null }).where(eq(schema.contacts.id, contact.id));
  return json({ ok: true });
});
