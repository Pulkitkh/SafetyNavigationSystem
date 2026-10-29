import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { sha256 } from "./auth";
import { ApiError } from "./http";
import { inviteToken } from "./validation";

/** The contact (and the person they protect) behind an invite token. */
export async function inviteFor(token: string) {
  if (!inviteToken.safeParse(token).success) throw new ApiError(404, "This invite link is not valid");
  const db = await getDb();
  const [row] = await db
    .select({ contact: schema.contacts, userName: schema.users.name })
    .from(schema.guardianInvites)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.guardianInvites.contactId))
    .innerJoin(schema.users, eq(schema.users.id, schema.contacts.userId))
    .where(eq(schema.guardianInvites.tokenHash, sha256(token)))
    .limit(1);
  if (!row) throw new ApiError(404, "This invite link is no longer valid. Ask for a new one.");
  return row;
}
