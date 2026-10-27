import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ApiError, json, parseBody, requireUser, route } from "@/lib/server/http";
import { contactInput } from "@/lib/server/validation";

type Ctx = { params: Promise<{ id: string }> };

async function owned(userId: string, id: string) {
  const db = await getDb();
  const contact = await db.query.contacts.findFirst({
    where: and(eq(schema.contacts.id, id), eq(schema.contacts.userId, userId)),
  });
  if (!contact) throw new ApiError(404, "Contact not found");
  return contact;
}

export const PATCH = route(async (req: NextRequest, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  await owned(user.id, id);
  const input = await parseBody(req, contactInput.partial());
  const db = await getDb();
  if (input.isPrimary) await db.update(schema.contacts).set({ isPrimary: false }).where(eq(schema.contacts.userId, user.id));
  const [contact] = await db.update(schema.contacts).set(input).where(eq(schema.contacts.id, id)).returning();
  return json({ contact });
});

export const DELETE = route(async (_req: NextRequest, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  const contact = await owned(user.id, id);
  const db = await getDb();
  await db.delete(schema.contacts).where(eq(schema.contacts.id, id));
  if (contact.isPrimary) {
    const next = await db.query.contacts.findFirst({ where: eq(schema.contacts.userId, user.id) });
    if (next) await db.update(schema.contacts).set({ isPrimary: true }).where(eq(schema.contacts.id, next.id));
  }
  return json({ ok: true });
});
