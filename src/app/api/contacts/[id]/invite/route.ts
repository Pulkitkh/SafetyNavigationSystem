import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newToken, sha256 } from "@/lib/server/auth";
import { ApiError, json, rateLimit, requireUser, route } from "@/lib/server/http";
import { appUrl } from "@/lib/server/url";

type Ctx = { params: Promise<{ id: string }> };

async function ownedContact(userId: string, id: string) {
  const db = await getDb();
  const contact = await db.query.contacts.findFirst({ where: and(eq(schema.contacts.id, id), eq(schema.contacts.userId, userId)) });
  if (!contact) throw new ApiError(404, "Contact not found");
  return contact;
}

/**
 * A fresh invite link for one contact. Only the hash is stored, so the link is
 * shown once; making a new one invalidates the old link (devices already
 * linked keep receiving alerts until removed).
 */
export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  const user = await requireUser();
  rateLimit(req, "invite", 30, 60 * 60_000);
  const { id } = await params;
  const contact = await ownedContact(user.id, id);
  const db = await getDb();
  const token = newToken();
  await db.delete(schema.guardianInvites).where(eq(schema.guardianInvites.contactId, contact.id));
  await db.insert(schema.guardianInvites).values({ tokenHash: sha256(token), contactId: contact.id });
  const url = `${appUrl(req)}/g/${token}`;
  const message = `${user.name} added you as a trusted contact on SafeNav. Open this link once and tap "Turn on alerts" so you're told instantly, with their live location, if they ever press SOS:\n${url}`;
  return json({ url, message });
});

/** Stop all automatic alerts to this contact: unlink every device and void the invite link. */
export const DELETE = route(async (_req: NextRequest, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  const contact = await ownedContact(user.id, id);
  const db = await getDb();
  await db.delete(schema.guardianDevices).where(eq(schema.guardianDevices.contactId, contact.id));
  await db.delete(schema.guardianInvites).where(eq(schema.guardianInvites.contactId, contact.id));
  return json({ ok: true });
});
