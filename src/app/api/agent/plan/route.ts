import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { LlmUnavailableError, llmConfigured } from "@/lib/agent/llm";
import { recordDecision } from "@/lib/agent/log";
import { AgentFailedError } from "@/lib/agent/loop";
import { runPlanner } from "@/lib/agent/planner";
import { currentUser } from "@/lib/server/auth";
import { ApiError, parseBody, rateLimit, route } from "@/lib/server/http";
import { agentPlanInput } from "@/lib/server/validation";

// Several tool calls, each of which may plan routes (up to ~90 s in the worst case).
export const maxDuration = 120;

/**
 * The Guardian route planner. Streams newline-delimited JSON so the app can
 * show each step as the agent takes it: {"type":"step"}…, then one
 * {"type":"result"} or {"type":"error"}.
 */
export const POST = route(async (req: NextRequest) => {
  if (!llmConfigured()) throw new ApiError(503, "The Guardian planner isn't set up on this server. Use the route planner below.");
  rateLimit(req, "agent-plan", 6, 60_000);
  rateLimit(req, "agent-plan-hour", 40, 60 * 60_000);
  const input = await parseBody(req, agentPlanInput);
  const user = await currentUser();
  let contacts = 0;
  if (user) {
    const db = await getDb();
    contacts = (await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.userId, user.id))).length;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        const result = await runPlanner({ request: input.request, here: input.here ?? null, stepFree: input.stepFree, contacts }, (step) => send({ type: "step", step }));
        if (user) {
          await recordDecision({
            userId: user.id,
            agent: "planner",
            trigger: "request",
            decision: result.status === "planned" ? "plan" : "asked",
            summary: result.status === "planned" ? `${result.destination?.label ? `To ${result.destination.label}: ` : ""}${result.summary}` : (result.question ?? result.summary),
            reasons: result.reasons,
            steps: result.steps,
            provider: result.provider,
            model: result.model,
            ms: result.ms,
          });
        }
        send({ type: "result", result });
      } catch (err) {
        const message =
          err instanceof LlmUnavailableError
            ? "The Guardian is busy right now. Use the route planner below, or try again in a minute."
            : err instanceof AgentFailedError
              ? "The Guardian couldn't settle on a plan. Try naming the place more precisely, e.g. with the area or city."
              : "Something went wrong while planning. Please try again.";
        if (!(err instanceof LlmUnavailableError || err instanceof AgentFailedError)) console.error(err);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
});
