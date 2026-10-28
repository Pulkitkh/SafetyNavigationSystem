import { createHash } from "node:crypto";
import { lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly service: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * OSM community services require an identifying User-Agent with contact details
 * (https://operations.osmfoundation.org/policies/).
 */
export function userAgent(): string {
  const contact = process.env.OSM_CONTACT_EMAIL || process.env.APP_URL || "unconfigured";
  return `SafeNav/1.0 (+${contact})`;
}

interface FetchOptions {
  service: string;
  timeoutMs?: number;
  retries?: number;
  init?: RequestInit;
}

export async function fetchJson<T>(url: string, { service, timeoutMs = 15_000, retries = 1, init }: FetchOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": userAgent(), Accept: "application/json", ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (res.ok) return (await res.json()) as T;
      // 429/5xx are transient on the shared public servers; anything else is final.
      if (res.status === 429 || res.status >= 500) {
        lastError = new UpstreamError(`${service} responded ${res.status}`, service, res.status);
        await sleep(800 * (attempt + 1));
        continue;
      }
      throw new UpstreamError(`${service} responded ${res.status}`, service, res.status);
    } catch (err) {
      if (err instanceof UpstreamError && err.status && err.status < 500 && err.status !== 429) throw err;
      lastError = err;
      if (attempt < retries) await sleep(800 * (attempt + 1));
    }
  }
  if (lastError instanceof UpstreamError) throw lastError;
  throw new UpstreamError(`${service} unavailable: ${(lastError as Error)?.message ?? "unknown error"}`, service);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Endpoints for a service, from a comma-separated env var with built-in fallbacks.
 * The public community servers rate-limit and go down independently, so every
 * call can fail over to the next mirror.
 */
export function endpoints(envValue: string | undefined, defaults: string[]): string[] {
  const configured = (envValue ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return configured.length ? configured : defaults;
}

/** Try `fn` against each base URL in turn; the first success wins. */
export async function withFailover<T>(bases: string[], fn: (base: string) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (const base of bases) {
    try {
      return await fn(base);
    } catch (err) {
      lastError = err;
      // A 4xx other than 429 means the request itself is wrong; another mirror won't help.
      if (err instanceof UpstreamError && err.status && err.status < 500 && err.status !== 429) throw err;
    }
  }
  throw lastError;
}

/** Expired entries stay this long so they can be served when every upstream is down. */
const STALE_KEEP_MS = 7 * 24 * 3600_000;

interface CacheOptions<T> {
  /** Return false for responses that must not be cached (e.g. partial results). */
  cacheable?: (value: T) => boolean;
}

/**
 * Read-through cache backed by the database, so serverless instances share results.
 * If the upstream fails and an expired entry exists, the stale value is returned:
 * slightly old map data is far better than no route at all.
 */
export async function cached<T>(
  namespace: string,
  keyParts: unknown,
  ttlMs: number,
  load: () => Promise<T>,
  { cacheable }: CacheOptions<T> = {},
): Promise<T> {
  const key = `${namespace}:${createHash("sha256").update(JSON.stringify(keyParts)).digest("hex")}`;
  const db = await getDb();
  const now = Date.now();
  let stale: T | undefined;
  try {
    const hit = await db.query.apiCache.findFirst({ where: (c, { eq }) => eq(c.key, key) });
    if (hit && hit.expiresAt.getTime() > now) return JSON.parse(hit.value) as T;
    if (hit) stale = JSON.parse(hit.value) as T;
  } catch {
    // A cache failure must never block routing or SOS.
  }
  let value: T;
  try {
    value = await load();
  } catch (err) {
    if (stale !== undefined) {
      console.warn(`[cache] serving stale ${namespace} entry: ${(err as Error).message}`);
      return stale;
    }
    throw err;
  }
  if (cacheable && !cacheable(value)) return value;
  try {
    await db
      .insert(schema.apiCache)
      .values({ key, value: JSON.stringify(value), expiresAt: new Date(now + ttlMs) })
      .onConflictDoUpdate({ target: schema.apiCache.key, set: { value: JSON.stringify(value), expiresAt: new Date(now + ttlMs) } });
    if (Math.random() < 0.02) await db.delete(schema.apiCache).where(lt(schema.apiCache.expiresAt, new Date(now - STALE_KEEP_MS)));
  } catch {
    // ignore
  }
  return value;
}
