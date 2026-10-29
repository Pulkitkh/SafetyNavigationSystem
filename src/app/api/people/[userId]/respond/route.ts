import type { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ApiError, json, parseBody, requireUser, route } from "@/lib/server/http";
import { personFor } from "@/lib/server/people";
import { sosResponseInput } from "@/lib/server/validation";

type Ctx = { params: Promise<{ userId: string }> };

/** "I'm on my way": shown at once on the SOS screen of the person in danger. */
export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  const me = await requireUser();
  const { userId } = await params;
  const { response } = await parseBody(req, sosResponseInput);
  const person = await personFor(me.id, userId);
  if (!person.trip || (person.trip.status !== "sos" && person.trip.status !== "alert")) throw new ApiError(409, `${person.name.split(" ")[0]} has no SOS open right now`);
  const db = await getDb();
  await db
    .insert(schema.sosResponses)
    .values({ tripId: person.trip.id, contactId: person.contactId, response })
    .onConflictDoUpdate({ target: [schema.sosResponses.tripId, schema.sosResponses.contactId], set: { response, createdAt: sql`now()` } });
  return json({ ok: true });
});
