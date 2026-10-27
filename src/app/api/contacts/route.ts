import type { NextRequest } from "next/server";
import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/server/auth";
import { ApiError, json, parseBody, requireUser, route } from "@/lib/server/http";
import { contactInput } from "@/lib/server/validation";

const MAX_CONTACTS = 5;

export const GET = route(async () => {
  const user = await requireUser();
  const db = await getDb();
  const contacts = await db
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.userId, user.id))
    .orderBy(desc(schema.contacts.isPrimary), asc(schema.contacts.createdAt));
  return json({ contacts });
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser();
  const input = await parseBody(req, contactInput);
  const db = await getDb();
  const existing = await db.select().from(schema.contacts).where(eq(schema.contacts.userId, user.id));
  if (existing.length >= MAX_CONTACTS) throw new ApiError(400, `You can add up to ${MAX_CONTACTS} trusted contacts`);
  if (existing.some((c) => c.phone === input.phone)) throw new ApiError(409, "This number is already in your contacts");
  const isPrimary = input.isPrimary || existing.length === 0;
  if (isPrimary) await db.update(schema.contacts).set({ isPrimary: false }).where(eq(schema.contacts.userId, user.id));
  const [contact] = await db
    .insert(schema.contacts)
    .values({ id: newId(), userId: user.id, name: input.name, phone: input.phone, relation: input.relation, isPrimary })
    .returning();
  return json({ contact }, 201);
});
