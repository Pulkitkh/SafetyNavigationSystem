import { defineConfig } from "drizzle-kit";

// Used by `npm run db:generate` to produce SQL for src/lib/db/migrate.ts.
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["safenav"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost/safenav" },
});
