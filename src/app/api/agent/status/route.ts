import { llmConfigured } from "@/lib/agent/llm";
import { json, route } from "@/lib/server/http";

/** Whether the Guardian agents can use a model on this server, so the app can offer them. */
export const GET = route(async () => json({ enabled: llmConfigured() }));
