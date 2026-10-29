import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { markSeen } from "@/lib/server/alerts";
import { sha256 } from "@/lib/server/auth";
import { ApiError, json, parseBody, rateLimit, route } from "@/lib/server/http";
import { seenInput, shareToken } from "@/lib/server/validation";

type Ctx = { params: Promise<{ token: string }> };

/** A contact opened the live link from their alert; the person in danger sees "Mum has seen your SOS". */
export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  rateLimit(req, "seen", 30, 60_000);
  const { token } = await params;
  if (!shareToken.safeParse(token).success) throw new ApiError(404, "This link is not valid");
  const { g } = await parseBody(req, seenInput);
  const db = await getDb();
  const trip = await db.query.trips.findFirst({ where: eq(schema.trips.shareTokenHash, sha256(token)), columns: { id: true } });
  if (!trip) throw new ApiError(404, "This link is not valid");
  await markSeen(trip.id, g);
  return json({ ok: true });
});
