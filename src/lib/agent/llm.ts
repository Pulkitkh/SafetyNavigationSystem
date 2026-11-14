/**
 * Chat with tool calling over free model tiers.
 *
 * Every provider is reached through its OpenAI-compatible endpoint, so one
 * request format covers them all. Providers are tried in order (Gemini, then
 * Groq, then OpenRouter, whichever have a key); one that is rate-limited, down
 * or rejects its key is skipped for a while, so a busy free tier never stalls
 * a decision. Keys travel in headers only and never appear in logs or errors.
 */

export type ProviderName = "gemini" | "groq" | "openrouter";

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments (the subset every provider accepts). */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON text, as the model wrote it. */
  arguments: string;
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "tool"; tool_call_id: string; content: string }
  // Assistant turns are passed back exactly as the provider returned them, so
  // provider-specific fields (such as Gemini's thought signatures) survive.
  | { role: "assistant"; content: string | null; tool_calls?: unknown[]; [extra: string]: unknown };

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** Total time allowed for this call, across providers. */
  timeoutMs: number;
  temperature?: number;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ToolCall[];
  /** The assistant message to append to the conversation for the next turn. */
  message: ChatMessage;
  provider: ProviderName;
  model: string;
}

export class LlmUnavailableError extends Error {}

interface Provider {
  name: ProviderName;
  base: string;
  keyEnv: string;
  modelEnv: string;
  models: string[];
}

const PROVIDERS: Record<ProviderName, Provider> = {
  gemini: {
    name: "gemini",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    // Aliases first: model names are retired often, the "latest" aliases are not.
    models: ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"],
  },
  groq: {
    name: "groq",
    base: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    models: ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"],
  },
  openrouter: {
    name: "openrouter",
    base: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
    models: ["meta-llama/llama-3.3-70b-instruct:free"],
  },
};

const DEFAULT_ORDER: ProviderName[] = ["gemini", "groq", "openrouter"];

/** Per-provider cool-down after a failure, doubling up to a cap. */
const cooldown = new Map<ProviderName, { until: number; ms: number }>();
/** Models that answered "not found", so they are not asked again this run. */
const goneModels = new Set<string>();

export function resetLlmForTests() {
  cooldown.clear();
  goneModels.clear();
  testImpl = null;
}

type ChatImpl = (req: ChatRequest) => Promise<ChatResponse>;
let testImpl: ChatImpl | null = null;
/** Tests replace the network with a scripted model. */
export function setChatForTests(impl: ChatImpl | null) {
  testImpl = impl;
}

function key(p: Provider): string {
  return process.env[p.keyEnv]?.trim() ?? "";
}

function order(): Provider[] {
  const configured = (process.env.AGENT_LLM_ORDER ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is ProviderName => s in PROVIDERS);
  return (configured.length ? configured : DEFAULT_ORDER).map((n) => PROVIDERS[n]).filter((p) => key(p));
}

/** True when at least one model provider has a key and the agents are not switched off. */
export function llmConfigured(): boolean {
  if (testImpl) return true;
  if (process.env.AGENT_ENABLED?.trim().toLowerCase() === "off") return false;
  return order().length > 0;
}

function modelsFor(p: Provider): string[] {
  const chosen = process.env[p.modelEnv]?.trim();
  const list = chosen ? [chosen, ...p.models.filter((m) => m !== chosen)] : p.models;
  return list.filter((m) => !goneModels.has(`${p.name}:${m}`));
}

function coolDown(p: ProviderName, baseMs: number) {
  const prev = cooldown.get(p);
  const ms = prev && prev.until > Date.now() - 60_000 ? Math.min(prev.ms * 2, 10 * 60_000) : baseMs;
  cooldown.set(p, { until: Date.now() + ms, ms });
}

function coolingDown(p: ProviderName) {
  return (cooldown.get(p)?.until ?? 0) > Date.now();
}

class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "model_gone" | "auth" | "busy" | "bad_request",
  ) {
    super(message);
  }
}

interface RawToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
}

async function callProvider(p: Provider, model: string, req: ChatRequest, timeoutMs: number): Promise<ChatResponse> {
  const body: Record<string, unknown> = {
    model,
    messages: req.messages,
    temperature: req.temperature ?? 0.2,
  };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
    body.tool_choice = "auto";
  }
  let res: Response;
  try {
    res = await fetch(`${p.base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key(p)}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    throw new ProviderError(`${p.name}: ${(err as Error).name === "TimeoutError" ? "timed out" : "unreachable"}`, "busy");
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300).toLowerCase();
    if (res.status === 404 || (res.status === 400 && /model|not found|deprecat|decommission|no endpoints/.test(text))) {
      throw new ProviderError(`${p.name}: model ${model} is not available`, "model_gone");
    }
    if (res.status === 401 || res.status === 403) throw new ProviderError(`${p.name}: key rejected (${res.status})`, "auth");
    if (res.status === 429 || res.status >= 500) throw new ProviderError(`${p.name}: busy (${res.status})`, "busy");
    throw new ProviderError(`${p.name}: request rejected (${res.status})`, "bad_request");
  }
  const data = (await res.json()) as { choices?: { message?: Record<string, unknown> }[] };
  const message = data.choices?.[0]?.message;
  if (!message) throw new ProviderError(`${p.name}: empty response`, "busy");
  const rawCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : []) as RawToolCall[];
  const toolCalls: ToolCall[] = [];
  rawCalls.forEach((c, i) => {
    if (!c.function?.name) return;
    // Some providers omit ids; the conversation needs one to pair the result.
    if (!c.id) c.id = `call_${Date.now().toString(36)}_${i}`;
    const args = typeof c.function.arguments === "string" ? c.function.arguments : JSON.stringify(c.function.arguments ?? {});
    c.function.arguments = args;
    toolCalls.push({ id: c.id, name: c.function.name, arguments: args });
  });
  const content = typeof message.content === "string" ? message.content : null;
  return {
    content,
    toolCalls,
    message: { ...message, role: "assistant", content, ...(rawCalls.length ? { tool_calls: rawCalls } : {}) } as ChatMessage,
    provider: p.name,
    model,
  };
}

/**
 * One model turn. Tries each configured provider and model in order until one
 * answers within the time left, and throws LlmUnavailableError if none can.
 */
export async function chat(req: ChatRequest): Promise<ChatResponse> {
  if (testImpl) return testImpl(req);
  const deadline = Date.now() + req.timeoutMs;
  const providers = order();
  if (!providers.length) throw new LlmUnavailableError("No model provider is configured");
  const problems: string[] = [];
  // Skip providers that are cooling down, unless every one is.
  const ready = providers.filter((p) => !coolingDown(p.name));
  for (const p of ready.length ? ready : providers) {
    for (const model of modelsFor(p)) {
      const left = deadline - Date.now();
      if (left < 1500) throw new LlmUnavailableError(`Out of time (${problems.join("; ") || "no answer"})`);
      try {
        const out = await callProvider(p, model, req, left);
        cooldown.delete(p.name);
        return out;
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
        problems.push(err.message);
        if (err.kind === "model_gone") {
          goneModels.add(`${p.name}:${model}`);
          continue; // next model, same provider
        }
        if (err.kind === "auth") coolDown(p.name, 10 * 60_000);
        else if (err.kind === "busy") coolDown(p.name, 60_000);
        break; // next provider
      }
    }
  }
  console.warn(`[agent] no model answered: ${problems.join("; ")}`);
  throw new LlmUnavailableError(problems.join("; ") || "No model answered");
}
