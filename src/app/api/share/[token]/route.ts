import type { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { sha256 } from "@/lib/server/auth";
import { ApiError, json, rateLimit, route } from "@/lib/server/http";
import { isShareVisible } from "@/lib/server/trips";
import { shareToken } from "@/lib/server/validation";

type Ctx = { params: Promise<{ token: string }> };

/** Public, read-only view of a shared trip. Knowing the unguessable token is the only access check. */
export const GET = route(async (req: NextRequest, { params }: Ctx) => {
  rateLimit(req, "share", 120, 60_000);
  const { token } = await params;
  if (!shareToken.safeParse(token).success) throw new ApiError(404, "This link is not valid");
  const db = await getDb();
  const [row] = await db
    .select({ trip: schema.trips, name: schema.users.name, phone: schema.users.phone })
    .from(schema.trips)
    .innerJoin(schema.users, eq(schema.users.id, schema.trips.userId))
    .where(eq(schema.trips.shareTokenHash, sha256(token)))
    .limit(1);
  if (!row || !isShareVisible(row.trip)) throw new ApiError(404, "This link has expired or is not valid");
  const t = row.trip;
  const points = await db
    .select({ lat: schema.tripPoints.lat, lng: schema.tripPoints.lng, at: schema.tripPoints.recordedAt })
    .from(schema.tripPoints)
    .where(eq(schema.tripPoints.tripId, t.id))
    .orderBy(desc(schema.tripPoints.recordedAt))
    .limit(300);
  const overdue = t.status !== "ended" && t.status !== "sos" && t.mode && Date.now() > t.expectedArrival.getTime() + 10 * 60_000;
  return json({
    name: row.name,
    phone: row.phone,
    mode: t.mode,
    status: t.status,
    overdue,
    alertReason: t.alertReason,
    destLabel: t.destLabel,
    dest: t.destLabel === "SOS alert" ? null : [t.destLng, t.destLat],
    route: t.destLabel === "SOS alert" ? [] : JSON.parse(t.routeJson),
    expectedArrival: t.expectedArrival,
    vehicleType: t.vehicleType,
    vehiclePlate: t.vehiclePlate,
    vehicleNote: t.vehicleNote,
    last: t.lastLat != null && t.lastLng != null ? { lat: t.lastLat, lng: t.lastLng, accuracy: t.lastAccuracy, at: t.lastSeenAt, battery: t.lastBattery } : null,
    trail: points.reverse().map((p) => [p.lng, p.lat]),
    startedAt: t.startedAt,
    endedAt: t.endedAt,
  });
});
