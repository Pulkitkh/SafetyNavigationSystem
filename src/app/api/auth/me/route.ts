import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { currentUser, toPublicUser } from "@/lib/server/auth";
import { json, parseBody, requireUser, route } from "@/lib/server/http";
import { updateMeInput } from "@/lib/server/validation";

export const GET = route(async () => {
  const user = await currentUser();
  return json({ user: user ? toPublicUser(user) : null });
});

export const PATCH = route(async (req: NextRequest) => {
  const user = await requireUser();
  const input = await parseBody(req, updateMeInput);
  const db = await getDb();
  const [updated] = await db.update(schema.users).set(input).where(eq(schema.users.id, user.id)).returning();
  return json({ user: toPublicUser(updated) });
});
