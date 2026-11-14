import type { ZodType, ZodTypeDef } from "zod";
import { chat, LlmUnavailableError, type ChatMessage, type ToolSpec } from "./llm";

/** A capability the agent may use. `run` receives arguments already validated by `args`. */
export interface AgentTool<A = unknown> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  args: ZodType<A, ZodTypeDef, unknown>;
  run: (args: A) => Promise<unknown>;
  /** One line for the decision log, e.g. "4 routes compared". */
  describe?: (args: A, result: unknown) => string;
}

export interface AgentStep {
  tool: string;
  /** What the step did, in plain words, for the decision log. */
  note: string;
  ms: number;
  ok: boolean;
}

export interface AgentRun<T> {
  output: T;
  steps: AgentStep[];
  provider: string;
  model: string;
  ms: number;
}

export interface RunOptions<T> {
  system: string;
  input: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each tool validates its own arguments
  tools: AgentTool<any>[];
  /** The final answer, given as the arguments of a `finish` call. */
  finish: { description: string; parameters: Record<string, unknown>; schema: ZodType<T, ZodTypeDef, unknown> };
  /** Total time for the whole run. */
  budgetMs: number;
  /** Most model turns before giving up. */
  maxTurns?: number;
  /** Called after each tool, so a UI can show progress. */
  onStep?: (step: AgentStep) => void;
}

export const FINISH = "finish";
/** Tool results are cut to this many characters before going back to the model. */
const MAX_RESULT_CHARS = 6000;

export class AgentFailedError extends Error {}

function clip(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…(truncated)` : text;
}

function parseArgs(raw: string): unknown {
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return undefined;
  }
}

/** Pulls a JSON object out of plain text, for models that answer without calling finish. */
export function jsonFromText(text: string | null): unknown {
  if (!text) return undefined;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return candidate ? JSON.parse(candidate) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The agent loop: the model sees the task and the tools, calls tools, sees
 * their results, and repeats until it calls `finish` with an answer that
 * passes validation. Bounded in turns and time; throws AgentFailedError (or
 * LlmUnavailableError) instead of ever returning an unchecked answer.
 */
export async function runAgent<T>(opts: RunOptions<T>): Promise<AgentRun<T>> {
  const started = Date.now();
  const deadline = started + opts.budgetMs;
  const maxTurns = opts.maxTurns ?? 6;
  const byName = new Map<string, AgentTool<unknown>>(opts.tools.map((t) => [t.name, t]));
  const specs: ToolSpec[] = [
    ...opts.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
    { name: FINISH, description: opts.finish.description, parameters: opts.finish.parameters },
  ];
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.input },
  ];
  const steps: AgentStep[] = [];
  let provider = "";
  let model = "";
  let nudged = false;

  for (let turn = 0; turn < maxTurns; turn++) {
    const left = deadline - Date.now();
    if (left < 2000) break;
    const reply = await chat({ messages, tools: specs, timeoutMs: left });
    provider = reply.provider;
    model = reply.model;
    messages.push(reply.message);

    if (!reply.toolCalls.length) {
      // A model that answers in prose: accept it if it is a valid answer, otherwise ask once for the finish call.
      const parsed = opts.finish.schema.safeParse(jsonFromText(reply.content));
      if (parsed.success) return { output: parsed.data, steps, provider, model, ms: Date.now() - started };
      if (nudged) break;
      nudged = true;
      messages.push({ role: "user", content: `Call the ${FINISH} tool now with your decision.` });
      continue;
    }

    for (const call of reply.toolCalls) {
      const args = parseArgs(call.arguments);
      if (call.name === FINISH) {
        const parsed = opts.finish.schema.safeParse(args);
        if (parsed.success) return { output: parsed.data, steps, provider, model, ms: Date.now() - started };
        const problem = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "answer"}: ${i.message}`).join("; ");
        messages.push({ role: "tool", tool_call_id: call.id, content: `Invalid answer, fix and call ${FINISH} again: ${problem}` });
        continue;
      }
      const tool = byName.get(call.name);
      const t0 = Date.now();
      if (!tool) {
        messages.push({ role: "tool", tool_call_id: call.id, content: `Unknown tool ${call.name}. Use one of: ${[...byName.keys(), FINISH].join(", ")}.` });
        continue;
      }
      const checked = tool.args.safeParse(args);
      if (!checked.success) {
        const problem = checked.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ");
        messages.push({ role: "tool", tool_call_id: call.id, content: `Invalid arguments: ${problem}` });
        steps.push({ tool: tool.name, note: "Invalid arguments, retried", ms: 0, ok: false });
        continue;
      }
      try {
        const result = await tool.run(checked.data);
        const step = { tool: tool.name, note: tool.describe?.(checked.data, result) ?? tool.name, ms: Date.now() - t0, ok: true };
        steps.push(step);
        opts.onStep?.(step);
        messages.push({ role: "tool", tool_call_id: call.id, content: clip(result) });
      } catch (err) {
        const step = { tool: tool.name, note: `Failed: ${(err as Error).message.slice(0, 120)}`, ms: Date.now() - t0, ok: false };
        steps.push(step);
        opts.onStep?.(step);
        messages.push({ role: "tool", tool_call_id: call.id, content: `Error: ${(err as Error).message.slice(0, 300)}` });
      }
    }
  }
  throw new AgentFailedError(`No valid decision within ${maxTurns} turns`);
}

export { LlmUnavailableError };
