"use client";

import { useEffect, useState } from "react";
import type { LngLat } from "@/lib/geo";
import type { PlanResult } from "@/lib/safety/plan";
import { api, ClientApiError } from "./api";

export interface GuardianStep {
  tool: string;
  note: string;
  ms: number;
  ok: boolean;
}

export interface GuardianPlan {
  status: "planned" | "need_more_info";
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
  steps: GuardianStep[];
  provider: string;
  model: string;
  ms: number;
}

export interface GuardianDecision {
  id: string;
  tripId: string | null;
  agent: "planner" | "watcher" | "escalation" | "triage";
  trigger: string;
  decision: string;
  summary: string;
  reasons: string[];
  steps: GuardianStep[];
  provider: string;
  model: string | null;
  ms: number;
  createdAt: string;
}

export interface WatchResult {
  action: "defer" | "check_in" | "escalate_early";
  message: string;
  contactNote?: string;
  deferMinutes?: number;
  reasons: string[];
  overridden?: string;
  provider: string;
  notified: number;
}

let enabledCache: boolean | null = null;

/** Whether this server has the Guardian agents switched on (a model key is configured). */
export function useGuardianEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(enabledCache);
  useEffect(() => {
    if (enabledCache != null) return;
    api<{ enabled: boolean }>("/api/agent/status")
      .then(({ enabled }) => {
        enabledCache = enabled;
        setEnabled(enabled);
      })
      .catch(() => setEnabled(false));
  }, []);
  return enabled;
}

/** Asks the planner agent, reporting each step as it streams in. */
export async function askPlanner(request: string, here: LngLat | null, stepFree: boolean, onStep: (s: GuardianStep) => void, signal?: AbortSignal): Promise<GuardianPlan> {
  let res: Response;
  try {
    res = await fetch("/api/agent/plan", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request, here, stepFree }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ClientApiError(0, "You appear to be offline");
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ClientApiError(res.status, data.error ?? `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line) as { type: "step"; step: GuardianStep } | { type: "result"; result: GuardianPlan } | { type: "error"; message: string };
      if (event.type === "step") onStep(event.step);
      else if (event.type === "result") return event.result;
      else throw new ClientApiError(503, event.message);
    }
    if (done) break;
  }
  throw new ClientApiError(502, "The Guardian stopped before finishing. Please try again.");
}

/** Asks the journey watcher what to do about a monitoring alert. Resolves to null if it can't answer in time. */
export async function askWatcher(body: Record<string, unknown>, timeoutMs = 12_000): Promise<WatchResult | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const { decision } = await api<{ decision: WatchResult }>("/api/agent/watch", { method: "POST", json: body, signal: ctrl.signal });
    return decision;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const AGENT_LABEL: Record<GuardianDecision["agent"], string> = {
  planner: "Route planner",
  watcher: "Journey watcher",
  escalation: "Escalation",
  triage: "Report triage",
};

export function providerLabel(p: string) {
  return p === "rules" ? "Safety rules" : p === "gemini" ? "Gemini" : p === "groq" ? "Groq" : p === "openrouter" ? "OpenRouter" : p;
}
