import type { NextRequest } from "next/server";
import { listDecisions } from "@/lib/agent/log";
import { json, rateLimit, requireUser, route } from "@/lib/server/http";

/** The signed-in user's Guardian decisions, newest first; ?tripId= narrows to one journey. */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser();
  rateLimit(req, "agent-decisions", 60, 60_000);
  const tripId = req.nextUrl.searchParams.get("tripId")?.slice(0, 64) || undefined;
  const limit = Number(req.nextUrl.searchParams.get("limit")) || 50;
  return json({ decisions: await listDecisions(user.id, { tripId, limit }) });
});
