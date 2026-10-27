import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { MIGRATION_SQL } from "./migrate";

export type DB = LibSQLDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __safenavDb?: { db: DB; client: Client; ready: Promise<void> } };

function open() {
  const url = process.env.DATABASE_URL ?? "file:./data/safenav.db";
  if (url.startsWith("file:")) {
    mkdirSync(path.dirname(url.slice("file:".length)), { recursive: true });
  }
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
  const db = drizzle(client, { schema });
  // Idempotent schema setup so a fresh checkout works without a migration step.
  const ready = client
    .executeMultiple(MIGRATION_SQL)
    .then(() => undefined);
  return { db, client, ready };
}

/** Returns the database once its schema is in place. */
export async function getDb(): Promise<DB> {
  if (!globalForDb.__safenavDb) globalForDb.__safenavDb = open();
  await globalForDb.__safenavDb.ready;
  return globalForDb.__safenavDb.db;
}

/** Test helper: drop the cached connection so a new DATABASE_URL takes effect. */
export function resetDbForTests() {
  globalForDb.__safenavDb = undefined;
}

export { schema };
