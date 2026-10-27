import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z, type ZodTypeAny } from "zod";
import { UpstreamError } from "@/lib/providers/http";
import { currentUser, type User } from "./auth";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "Request body must be JSON");
  }
  return schema.parse(body);
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new ApiError(401, "Please sign in first");
  return user;
}

/**
 * Cookie-authenticated writes must come from our own pages. SameSite=Lax already
 * blocks most cross-site posts; this closes the remaining gaps.
 */
export function assertSameOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return; // same-origin fetches from older browsers and server-to-server calls
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host === host) return;
  } catch {
    // fall through
  }
  throw new ApiError(403, "Cross-origin request rejected");
}

// Fixed-window rate limiter. Per instance, which is enough to blunt abuse of the
// shared public data services; put a CDN rule in front for hard limits.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(req: NextRequest, name: string, limit: number, windowMs: number) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const key = `${name}:${ip}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return;
  }
  if (++b.count > limit) throw new ApiError(429, "Too many requests, please wait a moment");
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/** Wraps a route handler with origin checks and consistent error responses. */
export function route<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      assertSameOrigin(req);
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) return json({ error: err.message }, err.status);
      if (err instanceof ZodError) {
        const first = err.issues[0];
        return json({ error: first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input" }, 400);
      }
      if (err instanceof UpstreamError) {
        console.error(`[upstream] ${err.message}`);
        return json({ error: `The ${err.service} service is not responding. Please try again shortly.` }, 502);
      }
      console.error(err);
      return json({ error: "Something went wrong" }, 500);
    }
  };
}
