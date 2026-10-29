import { boolean, doublePrecision, index, integer, pgSchema, primaryKey, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Everything lives in its own Postgres schema. On Supabase this keeps the
 * tables out of the auto-generated public REST API.
 */
export const safenav = pgSchema("safenav");

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();

export const users = safenav.table(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    // Escalate to SOS when a safety check-in is not answered in time.
    autoSos: boolean("auto_sos").notNull().default(true),
    // Always-on location sharing with linked trusted contacts (opt-in).
    shareLive: boolean("share_live").notNull().default(false),
    liveLat: doublePrecision("live_lat"),
    liveLng: doublePrecision("live_lng"),
    liveAccuracy: doublePrecision("live_accuracy"),
    liveBattery: doublePrecision("live_battery"),
    liveAt: ts("live_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const sessions = safenav.table(
  "sessions",
  {
    // SHA-256 of the cookie token; the raw token never touches the database.
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const contacts = safenav.table(
  "contacts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    relation: text("relation").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    // The contact's own SafeNav account, once they accept the invite while signed in.
    guardianUserId: text("guardian_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("contacts_user_idx").on(t.userId), index("contacts_guardian_idx").on(t.guardianUserId)],
);

export const reports = safenav.table(
  "reports",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    category: text("category").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    note: text("note"),
    // When the reported situation happened (not when it was filed).
    observedAt: ts("observed_at").notNull(),
    upvotes: integer("upvotes").notNull().default(0),
    flags: integer("flags").notNull().default(0),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("reports_geo_idx").on(t.lat, t.lng), index("reports_observed_idx").on(t.observedAt)],
);

export const reportVotes = safenav.table(
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

export const trips = safenav.table(
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
    destLat: doublePrecision("dest_lat").notNull(),
    destLng: doublePrecision("dest_lng").notNull(),
    // Planned route as a [lng,lat][] JSON string, for viewers and deviation checks.
    routeJson: text("route_json").notNull(),
    expectedArrival: ts("expected_arrival").notNull(),
    vehicleType: text("vehicle_type"),
    vehiclePlate: text("vehicle_plate"),
    vehicleNote: text("vehicle_note"),
    lastLat: doublePrecision("last_lat"),
    lastLng: doublePrecision("last_lng"),
    lastAccuracy: doublePrecision("last_accuracy"),
    lastBattery: doublePrecision("last_battery"),
    lastSeenAt: ts("last_seen_at"),
    alertReason: text("alert_reason"),
    // A second share token the server makes when it raises an alert itself,
    // because it only stores the hash of the one the phone made.
    serverTokenHash: text("server_token_hash"),
    // Server watchdog progress, so each step happens once (see watchdog.ts).
    nudgedAt: ts("nudged_at"),
    lostNotifiedAt: ts("lost_notified_at"),
    checkinSentAt: ts("checkin_sent_at"),
    overdueAlertedAt: ts("overdue_alerted_at"),
    startedAt: ts("created_at").notNull().defaultNow(),
    endedAt: ts("ended_at"),
  },
  (t) => [
    uniqueIndex("trips_share_idx").on(t.shareTokenHash),
    index("trips_server_share_idx").on(t.serverTokenHash),
    index("trips_user_idx").on(t.userId, t.status),
    index("trips_status_idx").on(t.status),
  ],
);

export const tripPoints = safenav.table(
  "trip_points",
  {
    id: serial("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    accuracy: doublePrecision("accuracy"),
    recordedAt: ts("recorded_at").notNull(),
  },
  (t) => [index("trip_points_trip_idx").on(t.tripId, t.recordedAt)],
);

export const sosEvents = safenav.table(
  "sos_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tripId: text("trip_id").references(() => trips.id, { onDelete: "set null" }),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    trigger: text("trigger", { enum: ["manual", "missed_checkin", "deviation"] }).notNull(),
    // Which automatic channels ran ("alerts", "gateway:<provider>"), or "device" when none did.
    channel: text("channel").notNull(),
    delivered: integer("delivered").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("sos_user_idx").on(t.userId)],
);

/**
 * A link a user sends to one trusted contact once. Opening it lets that contact
 * receive SOS alerts automatically, with no action needed from the user at the
 * moment of danger.
 */
export const guardianInvites = safenav.table("guardian_invites", {
  // SHA-256 of the token in the invite link.
  tokenHash: text("token_hash").primaryKey(),
  contactId: text("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

/** Where a trusted contact receives alerts: browser push, Telegram, WhatsApp, or the SafeNav app (FCM). */
export const guardianDevices = safenav.table(
  "guardian_devices",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["push", "telegram", "whatsapp", "fcm"] }).notNull(),
    // Push: the subscription endpoint. Telegram: the chat id. WhatsApp: the phone number, digits only. FCM: the device token.
    address: text("address").notNull(),
    // Push only: the subscription's p256dh and auth keys as JSON.
    keys: text("keys"),
    label: text("label"),
    failures: integer("failures").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("guardian_devices_addr_idx").on(t.contactId, t.kind, t.address), index("guardian_devices_contact_idx").on(t.contactId)],
);

/** Phones and browsers where a signed-in user gets SafeNav alerts: SOS from people they protect, and their own check-ins. */
export const appDevices = safenav.table(
  "app_devices",
  {
    token: text("token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // android | ios (Firebase token) | web (push endpoint, with its keys).
    platform: text("platform").notNull(),
    keys: text("keys"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("app_devices_user_idx").on(t.userId)],
);

/**
 * A running safety timer, kept on the server too, so the SOS still goes out
 * when the phone is switched off, out of battery or has the app closed.
 */
export const safetyTimers = safenav.table("safety_timers", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  endsAt: ts("ends_at").notNull(),
  note: text("note"),
  checkinSentAt: ts("checkin_sent_at"),
  createdAt: createdAt(),
});

/** One alert sent to one contact over one channel, so the person in danger can see who was reached. */
export const alertDeliveries = safenav.table(
  "alert_deliveries",
  {
    id: serial("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    deviceId: text("device_id"),
    kind: text("kind").notNull(), // sos | safe | journey
    channel: text("channel").notNull(), // push | telegram | whatsapp | fcm | sms_gateway
    ok: boolean("ok").notNull(),
    error: text("error"),
    // Set when the contact opens the live-tracking page from this alert.
    seenAt: ts("seen_at"),
    createdAt: createdAt(),
  },
  (t) => [index("alert_deliveries_trip_idx").on(t.tripId)],
);

/** A trusted contact's answer to an SOS ("I'm on my way", "Calling you"), shown on the SOS screen. */
export const sosResponses = safenav.table(
  "sos_responses",
  {
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    response: text("response", { enum: ["on_my_way", "calling", "called_112"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.contactId] })],
);

// Shared response cache for slow public APIs (Overpass, routing, geocoding).
export const apiCache = safenav.table("api_cache", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
});
