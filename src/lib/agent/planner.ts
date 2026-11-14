import { z } from "zod";
import type { LngLat } from "@/lib/geo";
import type { PlanResult } from "@/lib/safety/plan";
import { appTimezone, lightPeriod, wallParts } from "@/lib/time";
import { runAgent, type AgentStep } from "./loop";
import { checkAreaTool, findHelpTool, newToolContext, planRoutesTool, S, searchPlaceTool, weatherTool } from "./tools";

export interface PlannerInput {
  request: string;
  here: LngLat | null;
  now?: Date;
  stepFree?: boolean;
  contacts: number;
}

export interface PlannerResult {
  status: "planned" | "need_more_info";
  /** Asked when the request can't be planned as given. */
  question?: string;
  summary: string;
  reasons: string[];
  tips: string[];
  shareWithContacts: boolean;
  plan?: PlanResult;
  routeId?: string;
  from?: LngLat;
  destination?: { label: string; point: LngLat };
  departAt?: string;
  steps: AgentStep[];
  provider: string;
  model: string;
  ms: number;
}

const PERIOD_WORDS = { day: "daylight", twilight: "dusk", night: "dark", late_night: "late night, most shops shut" } as const;

export const PLANNER_SYSTEM = `You are SafeNav Guardian's route planner, an agent that plans the SAFEST journey for a traveller in an Indian city.

How to work:
1. Work out where they are going (search_place) and where from (their current location unless they name a start).
2. Check the destination area (check_area). Check the weather when it is evening or night or rain is likely.
3. Plan routes (plan_routes). Choose walk or ride: honour what they asked; if they didn't say, walk under ~2.5 km, ride beyond. If every walking route scores "avoid" after dark, also plan a ride and recommend it.
4. Pick the route to recommend. Safety comes first, but don't add more than ~8 minutes for under 3 safety points. Prefer the route tagged "recommended" unless you have a concrete reason.
5. Call finish.

Rules:
- Use only coordinates returned by tools. Never invent places, scores, distances or facts.
- If a place name is ambiguous, prefer the match nearest the traveller and name it in the summary.
- If the request is not about a journey, or the destination can't be found after two searches, finish with status "need_more_info" and one short question.
- Reasons must be concrete and come from tool results (e.g. "avoids an unlit 400 m stretch by the rail yard", "3 shops open along the way at 11 pm").
- Write for the traveller: plain, calm, short. Address them as "you"; never guess anyone's gender. No markdown.
- shareWithContacts: true after dark, for rides, or when any stretch scores below "good".`;

const finishParameters = S.obj(
  {
    status: S.enum(["planned", "need_more_info"], "planned, or need_more_info when you must ask the traveller something"),
    planId: S.str("planId from plan_routes (when planned)"),
    routeId: S.str("routeId of the route you recommend (when planned)"),
    destinationLabel: S.str("Short destination name"),
    question: S.str("One short question, only when status is need_more_info"),
    summary: S.str("ONE short sentence to the traveller (at most 20 words): what you chose and the main reason"),
    reasons: S.arr(S.str("A concrete reason"), "2 to 5 concrete reasons, from tool results"),
    tips: S.arr(S.str("A practical tip"), "0 to 3 practical tips for this journey"),
    shareWithContacts: S.bool("Share the journey live with trusted contacts"),
  },
  ["status", "summary", "reasons", "shareWithContacts"],
);

/** The current hour and light, in words, for the prompt. */
export function timeContext(now: Date, here: LngLat | null) {
  const tz = appTimezone();
  const p = wallParts(now, tz);
  const clock = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  const period = here ? lightPeriod(now, here[1], here[0], tz) : null;
  return `Local time ${clock} (${tz})${period ? `, ${PERIOD_WORDS[period]}` : ""}.`;
}

export async function runPlanner(input: PlannerInput, onStep?: (s: AgentStep) => void): Promise<PlannerResult> {
  const now = input.now ?? new Date();
  const ctx = newToolContext(input.here, now);
  const finish = z
    .object({
      status: z.enum(["planned", "need_more_info"]),
      planId: z.string().optional(),
      routeId: z.string().optional(),
      destinationLabel: z.string().max(120).optional(),
      question: z.string().max(300).optional(),
      summary: z.string().min(1).max(300),
      reasons: z.array(z.string().max(300)).max(6).default([]),
      tips: z.array(z.string().max(200)).max(4).default([]),
      shareWithContacts: z.boolean().default(true),
    })
    .superRefine((v, c) => {
      if (v.status === "need_more_info") {
        if (!v.question) c.addIssue({ code: z.ZodIssueCode.custom, path: ["question"], message: "required when status is need_more_info" });
        return;
      }
      const made = v.planId ? ctx.plans.get(v.planId) : undefined;
      if (!made) {
        c.addIssue({ code: z.ZodIssueCode.custom, path: ["planId"], message: `must be one of: ${[...ctx.plans.keys()].join(", ") || "call plan_routes first"}` });
        return;
      }
      if (!made.plan.routes.some((r) => r.id === v.routeId)) {
        c.addIssue({ code: z.ZodIssueCode.custom, path: ["routeId"], message: `must be one of: ${made.plan.routes.map((r) => r.id).join(", ") || "(no routes found)"}` });
      }
    });

  const context = [
    `Traveller's request: """${input.request.slice(0, 500)}"""`,
    timeContext(now, input.here),
    input.here ? `Their current location: lng ${input.here[0].toFixed(5)}, lat ${input.here[1].toFixed(5)}.` : "Their current location is unknown: they must name a start, or ask them for it.",
    input.stepFree ? "They need step-free routes (set stepFree)." : "",
    `Trusted contacts set up: ${input.contacts}.`,
  ]
    .filter(Boolean)
    .join("\n");

  const run = await runAgent({
    system: PLANNER_SYSTEM,
    input: context,
    tools: [searchPlaceTool(ctx), checkAreaTool(ctx), weatherTool(ctx), planRoutesTool(ctx), findHelpTool(ctx)],
    finish: { description: "Give your final plan (or your question) to the traveller.", parameters: finishParameters, schema: finish },
    budgetMs: 100_000,
    maxTurns: 9,
    onStep,
  });

  const out = run.output;
  const base = { steps: run.steps, provider: run.provider, model: run.model, ms: run.ms, reasons: out.reasons, tips: out.tips, shareWithContacts: out.shareWithContacts };
  if (out.status === "need_more_info") return { ...base, status: "need_more_info", question: out.question, summary: out.summary };
  const made = ctx.plans.get(out.planId!)!;
  return {
    ...base,
    status: "planned",
    summary: out.summary,
    plan: made.plan,
    routeId: out.routeId,
    from: made.from,
    destination: { label: out.destinationLabel?.trim() || made.toLabel, point: made.to },
    departAt: made.plan.departAt,
  };
}
