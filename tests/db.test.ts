import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { MIGRATION_SQL } from "@/lib/db/migrate";

describe("migration SQL", () => {
  it("creates every table, can run twice, and adds columns missing from older tables", async () => {
    const pg = new PGlite();
    // An older users table without the newer columns.
    await pg.exec(`CREATE SCHEMA safenav; CREATE TABLE safenav.users (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, password_hash text NOT NULL);`);
    await pg.exec(`INSERT INTO safenav.users (id, name, email, password_hash) VALUES ('u1', 'Asha', 'a@x.in', 'h')`);
    await pg.exec(MIGRATION_SQL);
    await pg.exec(MIGRATION_SQL);
    const tables = await pg.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'safenav'`);
    const names = tables.rows.map((r) => r.table_name);
    for (const t of ["users", "sessions", "contacts", "reports", "report_votes", "trips", "trip_points", "sos_events", "api_cache", "guardian_invites", "guardian_devices", "alert_deliveries", "app_devices", "sos_responses"]) {
      expect(names).toContain(t);
    }
    const u = await pg.query<{ share_live: boolean; auto_sos: boolean }>(`select share_live, auto_sos from safenav.users where id = 'u1'`);
    expect(u.rows[0]).toEqual({ share_live: false, auto_sos: true });
    await pg.close();
  });
});
