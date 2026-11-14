import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { haversine, distanceToPolyline, type LngLat } from "@/lib/geo";
import type { AreaSafety } from "@/lib/safety/area";
import { checkArea, helpNear, type HelpNearby, type HelpPlace } from "@/lib/safety/checks";
import { alertContacts, baseUrl } from "@/lib/server/alerts";
import { LlmUnavailableError, llmConfigured } from "./llm";
import { recordDecision } from "./log";
import { runAgent } from "./loop";
import { timeContext } from "./planner";
import { areaBrief, S } from "./tools";
import { within } from "./watcher";

export interface EscalationInput {
  userId: string;
  tripId: string;
  /** Why the SOS was raised, in words ("pressed SOS", "missed a safety check-in"). */
  reason: string;
  liveUrl: string;
  now?: Date;
}

export interface Brief {
  /** The update sent to contacts. */
  text: string;
  call112: boolean;
  reasons: string[];
  /** The nearest police station, used for the "go here" link. */
  police: HelpPlace | null;
  haven: HelpPlace | null;
}

const fmtM = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const mapsDir = (p: LngLat) => `https://www.google.com/maps/dir/?api=1&destination=${p[1].toFixed(6)},${p[0].toFixed(6)}`;

export const ESCALATION_SYSTEM = `You are SafeNav Guardian's escalation agent. An SOS has just been sent to the traveller's trusted contacts with a live-location link. Write ONE follow-up update for those contacts that helps them act fast.

Use only the facts given. Say, in 2-3 short sentences: where the person was last seen and how long ago (street or neighbourhood, not coordinates), what the area is like right now (lit or dark, open places, isolated or busy), and the single most useful next step. Name the nearest police station and its distance when known.
Set call112 true when the person can't be reached quickly would be dangerous: it is dark, the area scores low, they left their route, the SOS was automatic (they didn't answer), or a ride went off route.
Calm and factual. No markdown, no emojis, no speculation about what happened.`;

const finishSchema = z.object({
  update: z.string().min(20).max(420),
  call112: z.boolean(),
  reasons: z.array(z.string().max(200)).max(4).default([]),
});

const finishParameters = S.obj({
  update: S.str("2-3 sentences for the trusted contacts"),
  call112: S.bool("Advise calling 112 if they can't reach the person within 2 minutes"),
  reasons: S.arr(S.str("Why, from the facts"), "1 to 3 reasons for your advice"),
});

/** The brief without a model: the same facts, in a fixed form. */
export function rulesBrief(facts: { place: string | null; minutesAgo: number | null; area: AreaSafety | null; help: HelpNearby | null; automatic: boolean }): Brief {
  const police = facts.help?.police[0] ?? null;
  const haven = facts.help?.hospitals.find((h) => h.openNow) ?? null;
  const where = facts.place ? `Last seen near ${facts.place}` : "Last location is on the live map";
  const when = facts.minutesAgo != null ? (facts.minutesAgo < 1 ? " just now" : ` ${facts.minutesAgo} min ago`) : "";
  const area = facts.area && facts.area.confidence !== "insufficient" ? ` The area there scores ${facts.area.score}/100 right now (${facts.area.band}).` : "";
  const pol = police ? ` Nearest police: ${police.name ?? "police station"}, ${fmtM(police.distance)}.` : "";
  const call112 = facts.automatic || facts.area?.band === "avoid";
  return {
    text: `${where}${when}.${area}${pol} Call them now${call112 ? "; if you can't reach them within 2 minutes, dial 112" : ""}.`,
    call112,
    reasons: [facts.automatic ? "The SOS was automatic: they didn't answer a check-in." : "They pressed SOS."],
    police,
    haven,
  };
}

/**
 * Gathers what is known about the person's situation and sends contacts one
 * follow-up "situation update" after the SOS itself has gone out. It never
 * replaces, delays or cancels the SOS. Without a model it sends the rules' brief.
 */
export async function runEscalation(input: EscalationInput): Promise<Brief | null> {
  const t0 = Date.now();
  const now = input.now ?? new Date();
  const db = await getDb();
  const trip = await db.query.trips.findFirst({ where: eq(schema.trips.id, input.tripId) });
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, input.userId) });
  if (!trip || !user) return null;
  const contacts = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.userId, user.id));
  if (!contacts.length) return null;
  const point: LngLat | null = trip.lastLat != null && trip.lastLng != null ? [trip.lastLng, trip.lastLat] : null;

  const [areaCheck, help] = point ? await Promise.all([within(checkArea(point, now, { prewarm: false }), 6_000), within(helpNear(point, now), 6_000)]) : [null, null];
  const area = areaCheck?.area ?? null;
  const minutesAgo = trip.lastSeenAt ? Math.max(0, Math.round((now.getTime() - trip.lastSeenAt.getTime()) / 60_000)) : null;
  const route = (() => {
    try {
      return JSON.parse(trip.routeJson) as LngLat[];
    } catch {
      return null;
    }
  })();
  const journey = trip.destLabel !== "SOS alert";
  const offRouteM = journey && point && route && route.length > 1 ? Math.round(distanceToPolyline(point, route).distance) : null;
  const toDestM = journey && point ? Math.round(haversine(point, [trip.destLng, trip.destLat])) : null;
  const automatic = !/pressed SOS/i.test(input.reason);
  const facts = { place: area?.place ?? null, minutesAgo, area, help, automatic };

  let brief: Brief = rulesBrief(facts);
  let provider = "rules";
  let model: string | null = null;
  const steps = [
    { tool: "check_area", note: area ? `Checked where they were last seen: ${area.score}/100 (${area.band})` : "Street data for their last location wasn't available", ms: 0, ok: !!area },
    { tool: "find_help", note: help?.police[0] ? `Nearest police: ${help.police[0].name ?? "police station"}, ${fmtM(help.police[0].distance)}` : "Looked for police nearby", ms: 0, ok: !!help },
  ];

  if (llmConfigured()) {
    const factText = [
      `Person: ${user.name}. SOS reason: ${input.reason}.`,
      timeContext(now, point),
      journey ? `They were on a ${trip.mode === "ride" ? `cab/auto ride${trip.vehiclePlate ? ` (${trip.vehiclePlate})` : ""}` : "walk"} to ${trip.destLabel}.` : "They were not on a planned journey.",
      minutesAgo != null ? `Last location received ${minutesAgo} min ago.` : "No location received.",
      offRouteM != null ? `${offRouteM} m from their planned route; ${toDestM} m from the destination.` : "",
      `Area at last location: ${area ? JSON.stringify(areaBrief(area)) : "unknown"}.`,
      help ? `Help nearby: ${JSON.stringify({ police: help.police.slice(0, 2).map((p) => ({ name: p.name, metres: p.distance })), hospitals: help.hospitals.slice(0, 1).map((p) => ({ name: p.name, metres: p.distance, openNow: p.openNow })) })}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const run = await runAgent({
        system: ESCALATION_SYSTEM,
        input: factText,
        tools: [],
        finish: { description: "Give the update for the contacts.", parameters: finishParameters, schema: finishSchema },
        budgetMs: 15_000,
        maxTurns: 2,
      });
      // Never soften the rules: if they say call 112, so does the update.
      const call112 = run.output.call112 || brief.call112;
      brief = { ...brief, text: run.output.update.trim(), call112, reasons: run.output.reasons.length ? run.output.reasons : brief.reasons };
      provider = run.provider;
      model = run.model;
    } catch (err) {
      if (!(err instanceof LlmUnavailableError)) console.error(`[agent] escalation: ${(err as Error).message}`);
    }
  }

  const extras = [brief.police ? `Directions to ${brief.police.name ?? "the nearest police station"}: ${mapsDir(brief.police.point)}` : null, brief.call112 && !/112/.test(brief.text) ? "If you can't reach them within 2 minutes, dial 112." : null].filter(Boolean);
  await alertContacts(
    contacts.map((c) => c.id),
    {
      kind: "warning",
      tripId: trip.id,
      personUserId: user.id,
      title: `Update on ${user.name}'s SOS`,
      body: [brief.text, ...extras].join(" "),
      url: input.liveUrl || `${baseUrl()}/`,
      lat: trip.lastLat,
      lng: trip.lastLng,
    },
  ).catch((err) => console.error(`[agent] escalation alert: ${(err as Error).message}`));

  await recordDecision({
    userId: user.id,
    tripId: trip.id,
    agent: "escalation",
    trigger: automatic ? "automatic_sos" : "sos",
    decision: brief.call112 ? "brief_sent_call_112" : "brief_sent",
    summary: brief.text,
    reasons: brief.reasons,
    steps: [...steps, { tool: "notify_contacts", note: `Situation update sent to ${contacts.length} contact${contacts.length === 1 ? "" : "s"}`, ms: 0, ok: true }],
    provider,
    model,
    ms: Date.now() - t0,
  });
  return brief;
}

/** Runs the escalation agent in the background. The SOS has already gone out; this only adds the update. */
export function queueEscalation(input: EscalationInput) {
  if (!llmConfigured()) return;
  void runEscalation(input).catch((err) => console.error(`[agent] escalation failed: ${(err as Error).message}`));
}
