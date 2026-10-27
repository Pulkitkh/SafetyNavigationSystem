import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { createSession, hashPassword, newId, toPublicUser } from "@/lib/server/auth";
import { ApiError, json, parseBody, rateLimit, route } from "@/lib/server/http";
import { registerInput } from "@/lib/server/validation";

export const POST = route(async (req: NextRequest) => {
  rateLimit(req, "register", 5, 10 * 60_000);
  const input = await parseBody(req, registerInput);
  const db = await getDb();
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, input.email) });
  if (existing) throw new ApiError(409, "An account with this email already exists");
  const [user] = await db
    .insert(schema.users)
    .values({ id: newId(), name: input.name, email: input.email, phone: input.phone ?? null, passwordHash: await hashPassword(input.password) })
    .returning();
  await createSession(user.id);
  return json({ user: toPublicUser(user) }, 201);
});
