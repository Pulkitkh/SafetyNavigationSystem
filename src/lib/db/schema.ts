import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    // Escalate to SOS when a safety check-in is not answered in time.
    autoSos: integer("auto_sos", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    // SHA-256 of the cookie token; the raw token never touches the database.
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const contacts = sqliteTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    relation: text("relation").notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("contacts_user_idx").on(t.userId)],
);

export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    category: text("category").notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    note: text("note"),
    // When the reported situation happened (not when it was filed).
    observedAt: integer("observed_at", { mode: "timestamp_ms" }).notNull(),
    upvotes: integer("upvotes").notNull().default(0),
    flags: integer("flags").notNull().default(0),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("reports_geo_idx").on(t.lat, t.lng), index("reports_observed_idx").on(t.observedAt)],
);

export const reportVotes = sqliteTable(
  "report_votes",
  {
    reportId: text("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // +1 confirms the report, -1 flags it as wrong or abusive.
    value: integer("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.reportId, t.userId] })],
);

export const trips = sqliteTable(
  "trips",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SHA-256 of the public share token.
    shareTokenHash: text("share_token_hash").notNull(),
    mode: text("mode", { enum: ["walk", "ride"] }).notNull(),
    status: text("status", { enum: ["active", "alert", "sos", "ended"] }).notNull().default("active"),
    destLabel: text("dest_label").notNull(),
    destLat: real("dest_lat").notNull(),
    destLng: real("dest_lng").notNull(),
    // Planned route as an encoded [lng,lat][] JSON string, for viewers and deviation checks.
    routeJson: text("route_json").notNull(),
    expectedArrival: integer("expected_arrival", { mode: "timestamp_ms" }).notNull(),
    vehicleType: text("vehicle_type"),
    vehiclePlate: text("vehicle_plate"),
    vehicleNote: text("vehicle_note"),
    lastLat: real("last_lat"),
    lastLng: real("last_lng"),
    lastAccuracy: real("last_accuracy"),
    lastBattery: real("last_battery"),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
    alertReason: text("alert_reason"),
    startedAt: createdAt(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  },
  (t) => [uniqueIndex("trips_share_idx").on(t.shareTokenHash), index("trips_user_idx").on(t.userId, t.status)],
);

export const tripPoints = sqliteTable(
  "trip_points",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    accuracy: real("accuracy"),
    recordedAt: integer("recorded_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("trip_points_trip_idx").on(t.tripId, t.recordedAt)],
);

export const sosEvents = sqliteTable(
  "sos_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tripId: text("trip_id").references(() => trips.id, { onDelete: "set null" }),
    lat: real("lat"),
    lng: real("lng"),
    trigger: text("trigger", { enum: ["manual", "missed_checkin", "deviation"] }).notNull(),
    // "gateway" when SMS went out automatically, "device" when the phone's composer was used.
    channel: text("channel").notNull(),
    delivered: integer("delivered").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("sos_user_idx").on(t.userId)],
);

/**
 * A link a user sends to one trusted contact once. Opening it lets that contact
 * receive SOS alerts automatically (app notification or Telegram), with no
 * action needed from the user at the moment of danger.
 */
export const guardianInvites = sqliteTable("guardian_invites", {
  // SHA-256 of the token in the invite link.
  tokenHash: text("token_hash").primaryKey(),
  contactId: text("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

/** Where a trusted contact receives alerts: a browser/app push subscription or a Telegram chat. */
export const guardianDevices = sqliteTable(
  "guardian_devices",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["push", "telegram", "whatsapp"] }).notNull(),
    // Push: the subscription endpoint. Telegram: the chat id. WhatsApp: the phone number, digits only.
    address: text("address").notNull(),
    // Push only: the subscription's p256dh and auth keys as JSON.
    keys: text("keys"),
    label: text("label"),
    failures: integer("failures").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("guardian_devices_addr_idx").on(t.contactId, t.kind, t.address), index("guardian_devices_contact_idx").on(t.contactId)],
);

/** One alert sent to one contact over one channel, so the person in danger can see who was reached. */
export const alertDeliveries = sqliteTable(
  "alert_deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    deviceId: text("device_id"),
    kind: text("kind").notNull(), // sos | safe | journey
    channel: text("channel").notNull(), // push | telegram | sms_gateway
    ok: integer("ok", { mode: "boolean" }).notNull(),
    error: text("error"),
    // Set when the contact opens the live-tracking page from this alert.
    seenAt: integer("seen_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("alert_deliveries_trip_idx").on(t.tripId)],
);

// Shared response cache for slow public APIs (Overpass, routing, geocoding).
export const apiCache = sqliteTable("api_cache", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});
