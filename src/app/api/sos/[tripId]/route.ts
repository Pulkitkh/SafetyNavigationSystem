import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { json, requireUser, route } from "@/lib/server/http";
import { ownedTrip } from "@/lib/server/trips";

type Ctx = { params: Promise<{ tripId: string }> };

export interface ContactReach {
  contactId: string;
  delivered: string[];
  failed: string[];
  seenAt: string | null;
}

/** Who has been reached about this SOS, over which channels, and who has opened the live link. */
export const GET = route(async (_req: NextRequest, { params }: Ctx) => {
  const user = await requireUser();
  const { tripId } = await params;
  await ownedTrip(user.id, tripId);
  const db = await getDb();
  const rows = await db.select().from(schema.alertDeliveries).where(eq(schema.alertDeliveries.tripId, tripId));
  const byContact = new Map<string, ContactReach>();
  for (const r of rows) {
    if (!r.contactId || r.kind !== "sos") continue;
    const c = byContact.get(r.contactId) ?? { contactId: r.contactId, delivered: [], failed: [], seenAt: null };
    (r.ok ? c.delivered : c.failed).push(r.channel);
    if (r.seenAt && (!c.seenAt || r.seenAt.toISOString() < c.seenAt)) c.seenAt = r.seenAt.toISOString();
    byContact.set(r.contactId, c);
  }
  return json({ contacts: [...byContact.values()] });
});
