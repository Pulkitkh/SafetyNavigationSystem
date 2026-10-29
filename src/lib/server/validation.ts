import { z } from "zod";
import { normalizePhone, normalizePlate, VEHICLE_TYPES } from "@/lib/phone";
import { REPORT_CATEGORY_IDS } from "@/lib/reports";

export const lat = z.number().min(-90).max(90);
export const lng = z.number().min(-180).max(180);
export const point = z.tuple([lng, lat]);

const phone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid mobile number, e.g. 98765 43210" });
    return n ?? "";
  });

export const registerInput = z.object({
  name: z.string().trim().min(2, "Name is too short").max(60),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(200),
  phone: phone.optional().or(z.literal("").transform(() => undefined)),
});

export const loginInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1).max(200),
});

export const updateMeInput = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  phone: phone.optional().nullable(),
  autoSos: z.boolean().optional(),
  // Always-on location sharing with linked trusted contacts.
  shareLive: z.boolean().optional(),
});

export const RELATIONS = ["Mother", "Father", "Sister", "Brother", "Spouse", "Partner", "Friend", "Colleague", "Other"] as const;

export const contactInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  phone,
  relation: z.enum(RELATIONS),
  isPrimary: z.boolean().optional().default(false),
});

export const planInput = z.object({
  from: point,
  to: point,
  mode: z.enum(["walk", "ride"]).default("walk"),
  stepFree: z.boolean().optional().default(false),
  departAt: z
    .string()
    .datetime({ offset: true })
    .optional()
    .refine((v) => !v || Math.abs(new Date(v).getTime() - Date.now()) < 8 * 86_400_000, "Pick a time within a week"),
});

export const reportInput = z.object({
  category: z.enum(REPORT_CATEGORY_IDS),
  lat,
  lng,
  note: z.string().trim().max(280).optional(),
  observedAt: z
    .string()
    .datetime({ offset: true })
    .optional()
    .refine((v) => !v || (new Date(v).getTime() <= Date.now() + 60_000 && Date.now() - new Date(v).getTime() < 90 * 86_400_000), {
      message: "Time must be within the last 90 days",
    }),
});

/** Share tokens are generated on the device so the SOS text can be composed before any network call. */
export const shareToken = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/, "Invalid share token");

export const startTripInput = z
  .object({
    shareToken,
    mode: z.enum(["walk", "ride"]),
    destLabel: z.string().trim().min(1).max(120),
    dest: point,
    route: z.array(point).min(2).max(20_000),
    durationS: z.number().positive().max(24 * 3600),
    // Tell contacts who turned on alerts that the journey started, with the live link.
    notifyContacts: z.boolean().optional().default(true),
    vehicleType: z.enum(VEHICLE_TYPES).optional(),
    vehiclePlate: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v?.trim()) return undefined;
        const p = normalizePlate(v);
        if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid number plate, e.g. MP09 AB 1234" });
        return p ?? undefined;
      }),
    vehicleNote: z.string().trim().max(120).optional(),
  })
  .refine((t) => t.mode === "walk" || !!t.vehicleType, { message: "Choose the vehicle type", path: ["vehicleType"] });

export const locationInput = z.object({
  lat,
  lng,
  accuracy: z.number().min(0).max(10_000).optional(),
  battery: z.number().min(0).max(1).optional(),
  at: z.number().int().optional(),
});

export const tripStatusInput = z.object({
  status: z.enum(["active", "alert", "ended"]),
  reason: z.string().trim().max(120).optional(),
});

export const sosInput = z.object({
  shareToken,
  tripId: z.string().uuid().optional(),
  lat: lat.optional(),
  lng: lng.optional(),
  accuracy: z.number().min(0).max(10_000).optional(),
  trigger: z.enum(["manual", "missed_checkin", "deviation"]).default("manual"),
});

/** A new route mid-journey, e.g. after leaving the planned one. */
export const rerouteInput = z.object({
  route: z.array(point).min(2).max(20_000),
  durationS: z.number().positive().max(24 * 3600),
});

/** Browser push services we deliver to. Anything else is refused, so a subscription can't make the server call arbitrary URLs. */
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|web\.push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)$/;

const pushEndpoint = z
  .string()
  .url()
  .max(1000)
  .refine((u) => {
    try {
      const url = new URL(u);
      return url.protocol === "https:" && PUSH_HOSTS.test(url.hostname);
    } catch {
      return false;
    }
  }, "Unsupported push service");
const pushKeys = z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) });

export const pushSubscriptionInput = z.object({
  subscription: z.object({ endpoint: pushEndpoint, keys: pushKeys }),
  label: z.string().trim().max(60).optional(),
});

export const unsubscribeInput = z.object({ endpoint: z.string().url().max(1000) });

export const seenInput = z.object({ g: z.string().min(8).max(64) });

export const inviteToken = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);

/** A trusted contact's answer to an SOS. */
export const sosResponseInput = z.object({ response: z.enum(["on_my_way", "calling", "called_112"]) });

/**
 * A SafeNav install that gets alerts for this account: the Android app's
 * Firebase token, or the installed web app's push subscription.
 */
export const appDeviceInput = z.discriminatedUnion("platform", [
  z.object({ platform: z.enum(["android", "ios"]), token: z.string().min(20).max(4096) }),
  z.object({ platform: z.literal("web"), token: pushEndpoint, keys: pushKeys }),
]);

export const appDeviceRemoveInput = z.object({ token: z.string().min(20).max(4096) });

/** A safety timer mirrored to the server, which raises the SOS if the phone can't. */
export const safetyTimerInput = z.object({
  endsAt: z.number().int().positive(),
  note: z.string().trim().max(120).optional(),
});
