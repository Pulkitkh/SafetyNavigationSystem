import type { NextRequest } from "next/server";
import { haversine } from "@/lib/geo";
import { planRoutes } from "@/lib/safety/plan";
import { ApiError, json, parseBody, rateLimit, route } from "@/lib/server/http";
import { planInput } from "@/lib/server/validation";

// Worst case: routing failover (~30 s) then the street-data budget (45 s).
export const maxDuration = 90;

export const POST = route(async (req: NextRequest) => {
  rateLimit(req, "plan", 12, 60_000);
  const input = await parseBody(req, planInput);
  const distance = haversine(input.from, input.to);
  if (distance < 30) throw new ApiError(400, "Start and destination are the same place");
  if (distance > 150_000) throw new ApiError(400, "Destination is too far for city navigation");
  const departAt = input.departAt ? new Date(input.departAt) : new Date();
  const plan = await planRoutes(input.from, input.to, input.mode, departAt, { stepFree: input.stepFree });
  if (!plan.routes.length) throw new ApiError(404, "No route found between these places");
  return json(plan);
});
