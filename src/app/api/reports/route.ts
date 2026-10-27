import type { NextRequest } from "next/server";
import { and, between, desc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { REPORT_MAX_AGE_DAYS } from "@/lib/reports";
import { newId } from "@/lib/server/auth";
import { ApiError, json, parseBody, rateLimit, requireUser, route } from "@/lib/server/http";
import { reportInput } from "@/lib/server/validation";

export const GET = route(async (req: NextRequest) => {
  rateLimit(req, "reports", 60, 60_000);
  const parts = (req.nextUrl.searchParams.get("bbox") ?? "").split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new ApiError(400, "bbox=minLng,minLat,maxLng,maxLat is required");
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (maxLng - minLng > 0.5 || maxLat - minLat > 0.5) throw new ApiError(400, "Zoom in to see reports");
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.reports.id,
      category: schema.reports.category,
      lat: schema.reports.lat,
      lng: schema.reports.lng,
      note: schema.reports.note,
      observedAt: schema.reports.observedAt,
      upvotes: schema.reports.upvotes,
      flags: schema.reports.flags,
    })
    .from(schema.reports)
    .where(
      and(
        between(schema.reports.lat, minLat, maxLat),
        between(schema.reports.lng, minLng, maxLng),
        eq(schema.reports.hidden, false),
        gte(schema.reports.observedAt, new Date(Date.now() - REPORT_MAX_AGE_DAYS * 86_400_000)),
      ),
    )
    .orderBy(desc(schema.reports.observedAt))
    .limit(300);
  return json({ reports: rows });
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser();
  rateLimit(req, "report-create", 10, 60 * 60_000);
  const input = await parseBody(req, reportInput);
  const db = await getDb();
  const [report] = await db
    .insert(schema.reports)
    .values({
      id: newId(),
      userId: user.id,
      category: input.category,
      lat: input.lat,
      lng: input.lng,
      note: input.note || null,
      observedAt: input.observedAt ? new Date(input.observedAt) : new Date(),
    })
    .returning();
  return json({ report: { ...report, userId: undefined } }, 201);
});
