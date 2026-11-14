import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { getDb, resetDbForTests, schema } from "@/lib/db";
import { rulesBrief } from "@/lib/agent/escalation";
import { chat, LlmUnavailableError, resetLlmForTests, setChatForTests, type ChatRequest, type ChatResponse } from "@/lib/agent/llm";
import { listDecisions } from "@/lib/agent/log";
import { AgentFailedError, jsonFromText, runAgent } from "@/lib/agent/loop";
import { runPlanner } from "@/lib/agent/planner";
import { guardVerdicts, runTriage, type TriageItem } from "@/lib/agent/triage";
import { guardWatch, type WatchProposal } from "@/lib/agent/watcher";
import type { AreaSafety } from "@/lib/safety/area";

/** A scripted model: each turn returns the next scripted reply. */
function script(...turns: ((req: ChatRequest) => Partial<ChatResponse> & { calls?: { name: string; args: unknown }[] })[]) {
  const requests: ChatRequest[] = [];
  let i = 0;
  setChatForTests(async (req) => {
    requests.push(structuredClone(req));
    const t = turns[Math.min(i++, turns.length - 1)](req);
    const toolCalls = (t.calls ?? []).map((c, n) => ({ id: `c${i}-${n}`, name: c.name, arguments: JSON.stringify(c.args) }));
    return {
      content: t.content ?? null,
      toolCalls,
      message: { role: "assistant", content: t.content ?? null, tool_calls: toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) },
      provider: "gemini",
      model: "test-model",
    };
  });
  return requests;
}

const call = (name: string, args: unknown) => () => ({ calls: [{ name, args }] });

afterEach(() => {
  resetLlmForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("agent loop", () => {
  const echo = {
    name: "echo",
    description: "Echo",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    args: z.object({ text: z.string() }),
    run: async ({ text }: { text: string }) => ({ echoed: text.toUpperCase() }),
    describe: ({ text }: { text: string }) => `Echoed ${text}`,
  };
  const finish = { description: "Answer", parameters: {}, schema: z.object({ answer: z.string() }) };

  it("calls tools, feeds results back, and returns the validated finish", async () => {
    const requests = script(call("echo", { text: "hi" }), call("finish", { answer: "done" }));
    const steps: string[] = [];
    const run = await runAgent({ system: "s", input: "i", tools: [echo], finish, budgetMs: 10_000, onStep: (s) => steps.push(s.note) });
    expect(run.output).toEqual({ answer: "done" });
    expect(steps).toEqual(["Echoed hi"]);
    // The tool result went back to the model on the second turn.
    const toolMsg = requests[1].messages.find((m) => m.role === "tool");
    expect(toolMsg && "content" in toolMsg && toolMsg.content).toContain("HI");
  });

  it("rejects an invalid answer and lets the model correct it", async () => {
    const requests = script(call("finish", { answer: 42 }), call("finish", { answer: "fixed" }));
    const run = await runAgent({ system: "s", input: "i", tools: [], finish, budgetMs: 10_000 });
    expect(run.output.answer).toBe("fixed");
    expect(JSON.stringify(requests[1].messages)).toContain("Invalid answer");
  });

  it("reports bad tool arguments and unknown tools to the model instead of crashing", async () => {
    const requests = script(call("echo", { nope: 1 }), call("teleport", {}), call("finish", { answer: "ok" }));
    const run = await runAgent({ system: "s", input: "i", tools: [echo], finish, budgetMs: 10_000 });
    expect(run.output.answer).toBe("ok");
    expect(JSON.stringify(requests[2].messages)).toMatch(/Invalid arguments[\s\S]*Unknown tool teleport/);
    expect(run.steps[0]).toMatchObject({ tool: "echo", ok: false });
  });

  it("accepts a valid JSON answer written as text, and gives up after too many turns", async () => {
    script(() => ({ content: 'Here you go: ```json\n{"answer":"prose"}\n```' }));
    expect((await runAgent({ system: "s", input: "i", tools: [], finish, budgetMs: 10_000 })).output.answer).toBe("prose");

    script(call("echo", { text: "again" }));
    await expect(runAgent({ system: "s", input: "i", tools: [echo], finish, budgetMs: 10_000, maxTurns: 3 })).rejects.toBeInstanceOf(AgentFailedError);
  });

  it("extracts JSON from fenced or bare text", () => {
    expect(jsonFromText('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(jsonFromText('Sure. {"a":2} Done.')).toEqual({ a: 2 });
    expect(jsonFromText("no json")).toBeUndefined();
  });
});

describe("model providers", () => {
  const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), { status: 200 });

  it("falls back from a busy provider to the next, and from a retired model to the next model", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g-secret");
    vi.stubEnv("GROQ_API_KEY", "q-secret");
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const model = JSON.parse(String(init.body)).model as string;
        seen.push(`${new URL(url).host}:${model}`);
        if (url.includes("googleapis") && model === "gemini-flash-latest") return new Response("model not found", { status: 404 });
        if (url.includes("googleapis")) return new Response("quota", { status: 429 });
        return ok("from groq");
      }),
    );
    const out = await chat({ messages: [{ role: "user", content: "hi" }], timeoutMs: 10_000 });
    expect(out).toMatchObject({ provider: "groq", content: "from groq" });
    expect(seen).toEqual(["generativelanguage.googleapis.com:gemini-flash-latest", "generativelanguage.googleapis.com:gemini-2.5-flash", "api.groq.com:openai/gpt-oss-120b"]);

    // Gemini is now cooling down, so the next call goes straight to Groq.
    seen.length = 0;
    await chat({ messages: [{ role: "user", content: "hi" }], timeoutMs: 10_000 });
    expect(seen).toEqual(["api.groq.com:openai/gpt-oss-120b"]);
  });

  it("fails cleanly without leaking keys when no provider answers", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g-secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad key g-secret", { status: 401 })));
    const err = await chat({ messages: [{ role: "user", content: "hi" }], timeoutMs: 10_000 }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect(String(err.message)).not.toContain("g-secret");
  });

  it("parses tool calls and adds ids when a provider leaves them out", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ type: "function", function: { name: "finish", arguments: { a: 1 } } }] } }] }), { status: 200 })),
    );
    const out = await chat({ messages: [{ role: "user", content: "hi" }], tools: [{ name: "finish", description: "d", parameters: {} }], timeoutMs: 5_000 });
    expect(out.toolCalls).toEqual([{ id: expect.stringMatching(/^call_/), name: "finish", arguments: '{"a":1}' }]);
  });
});

function area(o: Partial<AreaSafety> = {}): AreaSafety {
  return {
    score: 78,
    band: "good",
    period: "night",
    factors: {} as AreaSafety["factors"],
    weights: {} as AreaSafety["weights"],
    reasons: [],
    highlights: ["Well lit"],
    openNearby: [{ id: "p", name: "Apollo Pharmacy", kind: "pharmacy", point: [75.9, 22.7], distance: 40, openNow: true }],
    nearestPolice: null,
    nearestHaven: null,
    stats: { streetsM: 900, litShare: 0.8, openPlaces: 3, cctv: 0, reports: 0 },
    confidence: "high" as AreaSafety["confidence"],
    range: { lo: 70, hi: 85 },
    notes: [],
    ...o,
  };
}

describe("watcher guardrails", () => {
  const defer: WatchProposal = { action: "defer", message: "You're at an open pharmacy; I'll check again soon.", deferMinutes: 12, reasons: ["Lit, open pharmacy"] };

  it("allows holding off only at a lit, mapped spot with somewhere open, and caps the wait", () => {
    const { decision, overridden } = guardWatch(defer, { anomaly: "stopped", deferredBefore: [] }, area());
    expect(overridden).toBeUndefined();
    expect(decision).toMatchObject({ action: "defer", deferMinutes: 5 });
  });

  it.each([
    ["off_route", [], area(), /leaving the route/],
    ["stopped", ["stopped"], area(), /already held off/],
    ["stopped", [], area({ score: 40, band: "avoid" }), /scores 40/],
    ["overdue", [], area({ openNearby: [] }), /nothing open/],
    ["stopped", [], null, /not enough map data/],
    ["stopped", [], area({ confidence: "insufficient" as AreaSafety["confidence"] }), /not enough map data/],
  ] as const)("turns a deferral into a check-in (%s)", (anomaly, before, a, why) => {
    const { decision, overridden } = guardWatch(defer, { anomaly, deferredBefore: [...before] }, a);
    expect(decision.action).toBe("check_in");
    expect(overridden).toMatch(why);
    expect(decision.message).toMatch(/Are you OK\?/);
  });

  it("never blocks asking sooner or alerting contacts early", () => {
    const early: WatchProposal = { action: "escalate_early", message: "Dark stretch. Are you OK?", reasons: [] };
    expect(guardWatch(early, { anomaly: "off_route", deferredBefore: [] }, null).decision.action).toBe("escalate_early");
  });
});

describe("escalation brief without a model", () => {
  it("states the facts and advises 112 for an automatic SOS", () => {
    const b = rulesBrief({
      place: "Vijay Nagar",
      minutesAgo: 2,
      area: area({ score: 41, band: "avoid" }),
      help: { police: [{ id: "x", name: "Vijay Nagar Police Station", kind: "police", point: [75.89, 22.75], distance: 640, openNow: true }], hospitals: [], pharmacies: [], fuel: [], source: "overpass" },
      automatic: true,
    });
    expect(b.text).toBe("Last seen near Vijay Nagar 2 min ago. The area there scores 41/100 right now (avoid). Nearest police: Vijay Nagar Police Station, 640 m. Call them now; if you can't reach them within 2 minutes, dial 112.");
    expect(b.call112).toBe(true);
  });
});

describe("planner", () => {
  it("only accepts a plan that was actually made, and can ask a question instead", async () => {
    const requests = script(call("finish", { status: "planned", planId: "p9", routeId: "r0", summary: "Go", reasons: [], shareWithContacts: true }), call("finish", { status: "need_more_info", question: "Which Sector 5: Salt Lake or Noida?", summary: "Need the city", reasons: [], shareWithContacts: false }));
    const out = await runPlanner({ request: "take me to sector 5", here: null, contacts: 0, now: new Date("2026-11-14T17:30:00Z") });
    expect(out).toMatchObject({ status: "need_more_info", question: "Which Sector 5: Salt Lake or Noida?" });
    expect(JSON.stringify(requests[1].messages)).toContain("call plan_routes first");
    // The prompt carries the local time and says the location is unknown.
    expect(requests[0].messages[1]).toMatchObject({ content: expect.stringMatching(/Local time 23:00[\s\S]*location is unknown/) });
  });
});

describe("report triage", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), "agent-")), "t.db")}`;
    resetDbForTests();
    await getDb();
  });

  const item = (id: string, candidates: string[] = []): TriageItem => ({ id, category: "harassment", note: null, minutesAgo: 5, candidates: candidates.map((c) => ({ id: c, category: "harassment", note: null, metres: 40 })) });

  it("keeps a report whose duplicate claim doesn't match a nearby report, or that the model skipped", () => {
    const out = guardVerdicts([item("a", ["old"]), item("b"), item("c")], [
      { id: "a", verdict: "duplicate", duplicateOf: "elsewhere", severity: 2, note: "" },
      { id: "b", verdict: "abusive", severity: 1, note: "spam" },
    ]);
    expect(out.map((v) => v.verdict)).toEqual(["credible", "abusive", "credible"]);
  });

  it("hides duplicates, abuse and personal details, confirms the original, and logs each verdict for the reporter", async () => {
    const db = await getDb();
    await db.insert(schema.users).values({ id: "u1", name: "Asha", email: "a@x.in", passwordHash: "x" });
    const base = { category: "harassment", lat: 22.72, lng: 75.86, userId: "u1" };
    const t = Date.now();
    await db.insert(schema.reports).values([
      { ...base, id: "orig", observedAt: new Date(t - 60 * 60_000), createdAt: new Date(t - 60 * 60_000), note: "Men following women near the bus stop" },
      { ...base, id: "dup", lat: 22.7202, observedAt: new Date(t - 20 * 60_000), createdAt: new Date(t - 20 * 60_000), note: "Same group again at the stop" },
      { ...base, id: "spam", lat: 22.79, observedAt: new Date(t), createdAt: new Date(t), note: "BUY CHEAP PHONES call 98xxxxxx" },
      { ...base, id: "pi", lat: 22.6, category: "poor_lighting", observedAt: new Date(t), createdAt: new Date(t), note: "Ramesh Kumar of house 12 left the light off" },
    ]);
    const requests = script((req) => {
      const items = JSON.parse(String(req.messages[1].content).split("\n").slice(1).join("\n")) as TriageItem[];
      // The server offered the earlier nearby report as the only candidate for the duplicate.
      expect(items.find((i) => i.id === "dup")?.candidates.map((c) => c.id)).toEqual(["orig"]);
      return {
        calls: [
          {
            name: "finish",
            args: {
              verdicts: [
                { id: "orig", verdict: "credible", severity: 3, note: "Harassment at a bus stop" },
                { id: "dup", verdict: "duplicate", duplicateOf: "orig", severity: 3, note: "Same incident" },
                { id: "spam", verdict: "abusive", severity: 1, note: "Advertising" },
                { id: "pi", verdict: "personal_info", severity: 1, note: "Names a private person" },
              ],
            },
          },
        ],
      };
    });
    const verdicts = await runTriage(new Date(), { force: true });
    expect(requests).toHaveLength(1);
    expect(verdicts).toHaveLength(4);
    const rows = Object.fromEntries((await db.select().from(schema.reports)).map((r) => [r.id, r]));
    expect(rows.orig).toMatchObject({ hidden: false, triage: "credible", severity: 3, upvotes: 1 });
    expect(rows.dup).toMatchObject({ hidden: true, triage: "duplicate", duplicateOf: "orig" });
    expect(rows.spam).toMatchObject({ hidden: true, triage: "abusive" });
    expect(rows.pi).toMatchObject({ hidden: true, triage: "personal_info" });

    const log = await listDecisions("u1");
    expect(log).toHaveLength(4);
    expect(log.map((d) => d.agent)).toEqual(["triage", "triage", "triage", "triage"]);
    expect(log.find((d) => d.decision === "duplicate")?.summary).toMatch(/merged with an earlier report/);

    // Nothing new: no model call.
    await runTriage(new Date(), { force: true });
    expect(requests).toHaveLength(1);
    expect((await db.select().from(schema.reports).where(eq(schema.reports.id, "orig")))[0].upvotes).toBe(1);
  });
});
