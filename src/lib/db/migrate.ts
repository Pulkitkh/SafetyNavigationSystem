// Generated from schema.ts with drizzle-kit and made idempotent (IF NOT EXISTS).
// Regenerate (npm run db:generate) when the schema changes.
export const MIGRATION_SQL = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS "api_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"expires_at" integer NOT NULL
);
CREATE TABLE IF NOT EXISTS "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"relation" text NOT NULL,
	"is_primary" integer DEFAULT false NOT NULL,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS "contacts_user_idx" ON "contacts" ("user_id");
CREATE TABLE IF NOT EXISTS "report_votes" (
	"report_id" text NOT NULL,
	"user_id" text NOT NULL,
	"value" integer NOT NULL,
	PRIMARY KEY("report_id", "user_id"),
	FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE IF NOT EXISTS "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"category" text NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"note" text,
	"observed_at" integer NOT NULL,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"flags" integer DEFAULT 0 NOT NULL,
	"hidden" integer DEFAULT false NOT NULL,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE set null
);
CREATE INDEX IF NOT EXISTS "reports_geo_idx" ON "reports" ("lat","lng");
CREATE INDEX IF NOT EXISTS "reports_observed_idx" ON "reports" ("observed_at");
CREATE TABLE IF NOT EXISTS "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" integer NOT NULL,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("user_id");
CREATE TABLE IF NOT EXISTS "sos_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"trip_id" text,
	"lat" real,
	"lng" real,
	"trigger" text NOT NULL,
	"channel" text NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON UPDATE no action ON DELETE set null
);
CREATE INDEX IF NOT EXISTS "sos_user_idx" ON "sos_events" ("user_id");
CREATE TABLE IF NOT EXISTS "trip_points" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"trip_id" text NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"accuracy" real,
	"recorded_at" integer NOT NULL,
	FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON UPDATE no action ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS "trip_points_trip_idx" ON "trip_points" ("trip_id","recorded_at");
CREATE TABLE IF NOT EXISTS "trips" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"share_token_hash" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"dest_label" text NOT NULL,
	"dest_lat" real NOT NULL,
	"dest_lng" real NOT NULL,
	"route_json" text NOT NULL,
	"expected_arrival" integer NOT NULL,
	"vehicle_type" text,
	"vehicle_plate" text,
	"vehicle_note" text,
	"last_lat" real,
	"last_lng" real,
	"last_accuracy" real,
	"last_battery" real,
	"last_seen_at" integer,
	"alert_reason" text,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
	"ended_at" integer,
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS "trips_share_idx" ON "trips" ("share_token_hash");
CREATE INDEX IF NOT EXISTS "trips_user_idx" ON "trips" ("user_id","status");
CREATE TABLE IF NOT EXISTS "guardian_invites" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE IF NOT EXISTS "guardian_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"kind" text NOT NULL,
	"address" text NOT NULL,
	"keys" text,
	"label" text,
	"failures" integer DEFAULT 0 NOT NULL,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS "guardian_devices_addr_idx" ON "guardian_devices" ("contact_id","kind","address");
CREATE INDEX IF NOT EXISTS "guardian_devices_contact_idx" ON "guardian_devices" ("contact_id");
CREATE TABLE IF NOT EXISTS "alert_deliveries" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"trip_id" text NOT NULL,
	"contact_id" text,
	"device_id" text,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"ok" integer NOT NULL,
	"error" text,
	"seen_at" integer,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON UPDATE no action ON DELETE set null
);
CREATE INDEX IF NOT EXISTS "alert_deliveries_trip_idx" ON "alert_deliveries" ("trip_id");
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"auto_sos" integer DEFAULT true NOT NULL,
	"created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");
`;
