import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { createSession, hashPassword, toPublicUser, verifyPassword } from "@/lib/server/auth";
import { ApiError, json, parseBody, rateLimit, route } from "@/lib/server/http";
import { loginInput } from "@/lib/server/validation";

// Compared against when the email is unknown, so response time does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;

export const POST = route(async (req: NextRequest) => {
  rateLimit(req, "login", 10, 10 * 60_000);
  const input = await parseBody(req, loginInput);
  const db = await getDb();
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, input.email) });
  const ok = await verifyPassword(input.password, user?.passwordHash ?? (await (dummyHash ??= hashPassword("unused-placeholder"))));
  if (!user || !ok) throw new ApiError(401, "Wrong email or password");
  await createSession(user.id);
  return json({ user: toPublicUser(user) });
});
