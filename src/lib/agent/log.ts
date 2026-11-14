import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/server/auth";
import type { AgentStep } from "./loop";

export type AgentName = "planner" | "watcher" | "escalation" | "triage";

export interface DecisionInput {
  userId?: string | null;
  tripId?: string | null;
  agent: AgentName;
  trigger: string;
  decision: string;
  summary: string;
  reasons?: string[];
  steps?: AgentStep[];
  /** The provider that answered, or "rules" when the decision was made without a model. */
  provider: string;
  model?: string | null;
  ms?: number;
}

export interface Decision {
  id: string;
  tripId: string | null;
  agent: AgentName;
  trigger: string;
  decision: string;
  summary: string;
  reasons: string[];
  steps: AgentStep[];
  provider: string;
  model: string | null;
  ms: number;
  createdAt: string;
}

/** Records a decision. Never throws: a failed log write must not undo the action it describes. */
export async function recordDecision(d: DecisionInput): Promise<string | null> {
  try {
    const db = await getDb();
    const id = newId();
    await db.insert(schema.agentDecisions).values({
      id,
      userId: d.userId ?? null,
      tripId: d.tripId ?? null,
      agent: d.agent,
      trigger: d.trigger,
      decision: d.decision,
      summary: d.summary.slice(0, 600),
      reasons: JSON.stringify((d.reasons ?? []).slice(0, 8).map((r) => r.slice(0, 300))),
      steps: JSON.stringify(d.steps ?? []),
      provider: d.provider,
      model: d.model ?? null,
      ms: Math.round(d.ms ?? 0),
    });
    return id;
  } catch (err) {
    console.error(`[agent] could not record a ${d.agent} decision: ${(err as Error).message}`);
    return null;
  }
}

function parseList<T>(text: string): T[] {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function listDecisions(userId: string, opts: { tripId?: string; limit?: number } = {}): Promise<Decision[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.agentDecisions)
    .where(opts.tripId ? and(eq(schema.agentDecisions.userId, userId), eq(schema.agentDecisions.tripId, opts.tripId)) : eq(schema.agentDecisions.userId, userId))
    .orderBy(desc(schema.agentDecisions.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
  return rows.map((r) => ({
    id: r.id,
    tripId: r.tripId,
    agent: r.agent as AgentName,
    trigger: r.trigger,
    decision: r.decision,
    summary: r.summary,
    reasons: parseList<string>(r.reasons),
    steps: parseList<AgentStep>(r.steps),
    provider: r.provider,
    model: r.model,
    ms: r.ms,
    createdAt: r.createdAt.toISOString(),
  }));
}
