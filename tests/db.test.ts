import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { MIGRATION_SQL } from "@/lib/db/migrate";

describe("migration SQL", () => {
  it("creates every table and can run twice", async () => {
    const client = createClient({ url: ":memory:" });
    await client.executeMultiple(MIGRATION_SQL);
    await client.executeMultiple(MIGRATION_SQL);
    const rows = await client.execute("select name from sqlite_master where type='table' order by name");
    const names = rows.rows.map((r) => r.name);
    for (const t of ["users", "sessions", "contacts", "reports", "report_votes", "trips", "trip_points", "sos_events", "api_cache"]) {
      expect(names).toContain(t);
    }
  });
});
