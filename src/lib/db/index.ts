import { mkdirSync } from "node:fs";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { MIGRATION_SQL } from "./migrate";

/**
 * Postgres everywhere.
 *
 * Production: DATABASE_URL is a Postgres URL (Supabase), so accounts, contacts
 * and trips survive restarts and redeploys. Several URLs may be given,
 * separated by spaces or commas; the first that connects is used.
 *
 * Local development and tests: without a Postgres URL, PGlite runs the same
 * Postgres engine in-process: in a folder (DATABASE_URL=file:./data/pg, the
 * default) or in memory (DATABASE_URL=memory:).
 */
export type DB = PostgresJsDatabase<typeof schema>;

interface Handle {
  db: DB;
  ready: Promise<void>;
  close: () => Promise<void>;
}

const globalForDb = globalThis as unknown as { __safenavDb?: Handle };

function isPostgresUrl(u: string) {
  return /^postgres(ql)?:\/\//.test(u);
}

/** Creates tables and columns if missing. A lock stops two instances migrating at once. */
async function migratePostgres(client: postgres.Sql) {
  await client.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(727274)`;
    await tx.unsafe(MIGRATION_SQL);
  });
}

async function connectPostgres(urls: string[]): Promise<{ db: DB; client: postgres.Sql }> {
  let lastError: unknown;
  for (const url of urls) {
    const client = postgres(url, {
      // Supabase's pooler and SSL; prepared statements off so either pooler mode works.
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
      prepare: false,
      max: Number(process.env.DATABASE_POOL_SIZE) || 5,
      idle_timeout: 60,
      connect_timeout: 15,
      onnotice: () => {},
    });
    try {
      await migratePostgres(client);
      const host = new URL(url).host;
      console.log(`[db] connected to Postgres at ${host}`);
      return { db: drizzlePostgres(client, { schema }), client };
    } catch (err) {
      lastError = err;
      console.error(`[db] ${new URL(url).host}: ${(err as Error).message}`);
      await client.end({ timeout: 1 }).catch(() => {});
    }
  }
  throw lastError ?? new Error("No database URL could be reached");
}

async function connectPglite(url: string): Promise<{ db: DB; close: () => Promise<void> }> {
  // Loaded only when needed, so production never pulls in the WASM engine.
  const [{ PGlite }, { drizzle: drizzlePglite }] = await Promise.all([import("@electric-sql/pglite"), import("drizzle-orm/pglite")]);
  const memory = url === "memory:" || url === ":memory:";
  const dir = memory ? undefined : url.replace(/^file:/, "") || "./data/pg";
  if (dir) mkdirSync(dir, { recursive: true });
  const pg = new PGlite(dir);
  await pg.exec(MIGRATION_SQL);
  return { db: drizzlePglite(pg, { schema }) as unknown as DB, close: () => pg.close() };
}

function open(): Handle {
  const raw = (process.env.DATABASE_URL ?? "").trim();
  const urls = raw.split(/[\s,]+/).filter(isPostgresUrl);
  let db: DB | null = null;
  let close: () => Promise<void> = async () => {};
  const ready = (async () => {
    if (urls.length) {
      const c = await connectPostgres(urls);
      db = c.db;
      close = () => c.client.end({ timeout: 5 });
    } else {
      if (process.env.NODE_ENV === "production" && !raw) {
        console.warn("[db] DATABASE_URL is not set: using a local PGlite folder, which is lost when this server's disk is reset.");
      }
      const c = await connectPglite(raw || "file:./data/pg");
      db = c.db;
      close = c.close;
    }
  })();
  return {
    get db() {
      if (!db) throw new Error("Database not ready");
      return db;
    },
    ready,
    close: () => close(),
  };
}

/** Returns the database once its schema is in place. */
export async function getDb(): Promise<DB> {
  if (!globalForDb.__safenavDb) globalForDb.__safenavDb = open();
  const handle = globalForDb.__safenavDb;
  try {
    await handle.ready;
  } catch (err) {
    // Don't cache a failed connection: the next request tries again.
    if (globalForDb.__safenavDb === handle) globalForDb.__safenavDb = undefined;
    throw err;
  }
  return handle.db;
}

/** Test helper: drop the cached connection so a new DATABASE_URL takes effect. */
export function resetDbForTests() {
  const h = globalForDb.__safenavDb;
  globalForDb.__safenavDb = undefined;
  void h?.ready.then(() => h.close()).catch(() => {});
}

export { schema };
