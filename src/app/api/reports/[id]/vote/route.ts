import type { NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { ApiError, json, parseBody, requireUser, route } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

const HIDE_AFTER_FLAGS = 3;

export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  const { value } = await parseBody(req, z.object({ value: z.union([z.literal(1), z.literal(-1)]) }));
  const db = await getDb();
  const report = await db.query.reports.findFirst({ where: eq(schema.reports.id, id) });
  if (!report) throw new ApiError(404, "Report not found");
  if (report.userId === user.id) throw new ApiError(400, "You can't vote on your own report");

  await db
    .insert(schema.reportVotes)
    .values({ reportId: id, userId: user.id, value })
    .onConflictDoUpdate({ target: [schema.reportVotes.reportId, schema.reportVotes.userId], set: { value } });

  // Recount from the votes table so repeated or changed votes stay consistent.
  const [counts] = await db
    .select({
      up: sql<number>`coalesce(sum(case when ${schema.reportVotes.value} = 1 then 1 else 0 end), 0)`,
      down: sql<number>`coalesce(sum(case when ${schema.reportVotes.value} = -1 then 1 else 0 end), 0)`,
    })
    .from(schema.reportVotes)
    .where(eq(schema.reportVotes.reportId, id));
  const hidden = counts.down >= HIDE_AFTER_FLAGS && counts.down > counts.up;
  await db
    .update(schema.reports)
    .set({ upvotes: counts.up, flags: counts.down, hidden })
    .where(and(eq(schema.reports.id, id)));
  return json({ upvotes: counts.up, flags: counts.down, hidden });
});
