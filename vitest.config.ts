import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: { TZ: "UTC" },
    // Tests that touch the database boot a real Postgres engine (PGlite), which takes a few seconds.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
