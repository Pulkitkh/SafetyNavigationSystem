import { z } from "zod";
import type { LngLat } from "@/lib/geo";
import type { Anomaly } from "@/lib/monitor";
import type { AreaSafety } from "@/lib/safety/area";
import { checkArea } from "@/lib/safety/checks";
import { runAgent } from "./loop";
import { timeContext } from "./planner";
import { areaBrief, S } from "./tools";

export type WatchAction = "defer" | "check_in" | "escalate_early";

export interface WatchInput {
  anomaly: Anomaly;
  mode: "walk" | "ride";
  point: LngLat;
  accuracyM: number;
  destLabel: string;
  /** Metres from the planned route. */
  offRouteM?: number;
  /** Minutes without moving. */
  stoppedMin?: number;
  /** Minutes past the expected arrival. */
  lateMin?: number;
  remainingM?: number;
  vehicle?: string | null;
  /** Anomalies already deferred on this trip: a second deferral of the same kind is never allowed. */
  deferredBefore: Anomaly[];
  now?: Date;
}

export interface WatchDecision {
  action: WatchAction;
  /** What the traveller sees: the check-in question, or why the agent is holding off. */
  message: string;
  /** For escalate_early: the heads-up for trusted contacts. */
  contactNote?: string;
  deferMinutes?: number;
  reasons: string[];
  /** Set when a guardrail changed the model's proposal. */
  overridden?: string;
  provider: string;
  model: string | null;
  ms: number;
}

/** A check-in, a deferral or an early escalation, as proposed by the model, before guardrails. */
export interface WatchProposal {
  action: WatchAction;
  message: string;
  contactNote?: string;
  deferMinutes?: number;
  reasons: string[];
}

export const DEFER_MIN_SCORE = 60;
export const DEFER_MAX_MIN = 5;

const ANOMALY_WORDS: Record<Anomaly, string> = {
  off_route: "left the planned route",
  stopped: "has not moved for a while",
  overdue: "is late arriving",
};

const DEFAULT_QUESTION: Record<Anomaly, string> = {
  off_route: "You seem to have left the planned route. Are you OK?",
  stopped: "You haven't moved for a while. Are you OK?",
  overdue: "You're taking longer than expected to arrive. Are you OK?",
};

/**
 * Hard limits on what the watcher may do, applied to every proposal. Holding
 * off a check-in is only allowed where the facts (not the model) say the spot
 * is lit, mapped and has somewhere open; leaving the route is never waved away.
 * Asking sooner or alerting contacts early is always allowed: it only adds care.
 */
export function guardWatch(p: WatchProposal, input: Pick<WatchInput, "anomaly" | "deferredBefore">, area: AreaSafety | null): { decision: WatchProposal; overridden?: string } {
  if (p.action !== "defer") return { decision: p };
  const why = (() => {
    if (input.anomaly === "off_route") return "leaving the route is always checked";
    if (input.deferredBefore.includes(input.anomaly)) return "already held off once on this journey";
    if (!area || area.confidence === "insufficient") return "not enough map data to confirm the spot is safe";
    if (area.band === "avoid" || area.score < DEFER_MIN_SCORE) return `the spot scores ${area.score}/100`;
    const somewhereOpen = area.openNearby.length > 0 || (area.nearestHaven?.openNow === true && area.nearestHaven.distance <= 300);
    if (!somewhereOpen) return "nothing open nearby";
    return null;
  })();
  if (why) {
    return {
      decision: { ...p, action: "check_in", message: DEFAULT_QUESTION[input.anomaly], deferMinutes: undefined, reasons: [...p.reasons, `Checked in anyway: ${why}.`] },
      overridden: why,
    };
  }
  return { decision: { ...p, deferMinutes: Math.min(DEFER_MAX_MIN, Math.max(2, Math.round(p.deferMinutes ?? 4))) } };
}

export const WATCHER_SYSTEM = `You are SafeNav Guardian's journey watcher. A traveller on a monitored journey has triggered an alert rule. Decide what to do, using the facts given about where they are right now.

Actions:
- "check_in": ask "Are you OK?" now (60 s to answer, then SOS). The normal, safe default.
- "escalate_early": ask now with a SHORT countdown AND give trusted contacts a heads-up. Use when the spot is dark, isolated or reported, it is night, or a ride has turned onto isolated roads, so a problem here is more likely.
- "defer": wait a few minutes before asking. Only for a stop or a late arrival at a spot that is well lit, mapped, and has places open right now (e.g. waiting at an open pharmacy or a busy market). Never for leaving the route.

Write "message" to the traveller: one short, specific, calm sentence that says what you noticed and where (e.g. "You've stopped on a dark stretch near the rail yard. Are you OK?"). For defer, say what you'll do ("You're by an open pharmacy on a lit street, so I'll check again in 4 minutes.").
For escalate_early also write "contactNote": one factual sentence for their contacts, no alarmism.
Give 2-4 short reasons, from the facts only. Never invent places or facts. Address the traveller as "you"; never guess anyone's gender.`;

const proposalSchema = z.object({
  action: z.enum(["defer", "check_in", "escalate_early"]),
  message: z.string().min(5).max(220),
  contactNote: z.string().max(260).optional(),
  deferMinutes: z.coerce.number().min(1).max(30).optional(),
  reasons: z.array(z.string().max(200)).max(5).default([]),
});

const finishParameters = S.obj(
  {
    action: S.enum(["defer", "check_in", "escalate_early"], "What to do now"),
    message: S.str("One sentence to the traveller"),
    contactNote: S.str("For escalate_early: one factual sentence for trusted contacts"),
    deferMinutes: S.int("For defer: minutes to wait, 2 to 5"),
    reasons: S.arr(S.str("A short reason from the facts"), "2 to 4 reasons"),
  },
  ["action", "message", "reasons"],
);

/** Resolves to null instead of waiting past the deadline or failing. */
export function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms).unref?.())]);
}

export function watchFacts(input: WatchInput, area: AreaSafety | null, now: Date) {
  const situation = [
    `The traveller ${ANOMALY_WORDS[input.anomaly]}.`,
    input.anomaly === "off_route" && input.offRouteM != null ? `${Math.round(input.offRouteM)} m from the planned route.` : "",
    input.anomaly === "stopped" && input.stoppedMin != null ? `Not moved for ${Math.round(input.stoppedMin)} minutes.` : "",
    input.anomaly === "overdue" && input.lateMin != null ? `${Math.round(input.lateMin)} minutes past the expected arrival.` : "",
    input.remainingM != null ? `${(input.remainingM / 1000).toFixed(1)} km still to go.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return [
    `Journey: ${input.mode === "ride" ? `a cab/auto ride${input.vehicle ? ` (${input.vehicle})` : ""}` : "walking"} to ${input.destLabel}.`,
    timeContext(now, input.point),
    `What happened: ${situation}`,
    `GPS accuracy: about ${Math.round(input.accuracyM)} m.`,
    `Where they are now: ${area ? JSON.stringify(areaBrief(area)) : "no street data available in time"}.`,
    input.deferredBefore.length ? `Already held off once this journey for: ${input.deferredBefore.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Decides how to respond to an alert rule. Bounded to a few seconds: if the
 * street data or the model is slow or unavailable, it falls back to the
 * rules' own answer (a normal check-in), which is what SafeNav did before.
 */
export async function runWatcher(input: WatchInput, budgetMs = 9_000): Promise<WatchDecision> {
  const t0 = Date.now();
  const now = input.now ?? new Date();
  const area = (await within(checkArea(input.point, now, { prewarm: false }), Math.min(4_000, budgetMs / 2)))?.area ?? null;
  const fallback = (why: string): WatchDecision => ({
    action: "check_in",
    message: DEFAULT_QUESTION[input.anomaly],
    reasons: [why],
    provider: "rules",
    model: null,
    ms: Date.now() - t0,
  });
  try {
    const run = await runAgent({
      system: WATCHER_SYSTEM,
      input: watchFacts(input, area, now),
      tools: [],
      finish: { description: "Give your decision.", parameters: finishParameters, schema: proposalSchema },
      budgetMs: Math.max(2_500, budgetMs - (Date.now() - t0)),
      maxTurns: 2,
    });
    const { decision, overridden } = guardWatch(run.output, input, area);
    return {
      action: decision.action,
      message: decision.message,
      contactNote: decision.action === "escalate_early" ? decision.contactNote?.trim() || undefined : undefined,
      deferMinutes: decision.action === "defer" ? decision.deferMinutes : undefined,
      reasons: decision.reasons,
      overridden,
      provider: run.provider,
      model: run.model,
      ms: Date.now() - t0,
    };
  } catch (err) {
    console.warn(`[agent] watcher used the check-in rule: ${(err as Error).message}`);
    return fallback("The Guardian model didn't answer in time, so the standard check-in rule applied.");
  }
}
