import type { NextRequest } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { llmConfigured } from "@/lib/agent/llm";
import { recordDecision } from "@/lib/agent/log";
import { runWatcher, type WatchDecision } from "@/lib/agent/watcher";
import type { Anomaly } from "@/lib/monitor";
import { alertContacts, baseUrl } from "@/lib/server/alerts";
import { ApiError, json, parseBody, rateLimit, requireUser, route } from "@/lib/server/http";
import { serverShareToken, vehicleLine } from "@/lib/server/sos";
import { agentWatchInput } from "@/lib/server/validation";

export const maxDuration = 30;

/** A heads-up to contacts goes out at most this often per trip. */
const HEADS_UP_EVERY_MS = 15 * 60_000;

const TRIGGER_WORDS: Record<Anomaly, string> = { off_route: "Left the route", stopped: "Stopped moving", overdue: "Running late" };

/**
 * The journey watcher: asked by the phone when a monitoring rule fires, it
 * decides whether to check in now, hold off briefly, or check in fast and
 * give contacts a heads-up, and sends that heads-up itself.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser();
  rateLimit(req, "agent-watch", 20, 10 * 60_000);
  const input = await parseBody(req, agentWatchInput);
  const db = await getDb();
  const trip = await db.query.trips.findFirst({ where: and(eq(schema.trips.id, input.tripId), eq(schema.trips.userId, user.id)) });
  if (!trip || trip.status === "ended") throw new ApiError(404, "Journey not found");

  const earlier = await db
    .select({ trigger: schema.agentDecisions.trigger, decision: schema.agentDecisions.decision, createdAt: schema.agentDecisions.createdAt })
    .from(schema.agentDecisions)
    .where(and(eq(schema.agentDecisions.tripId, trip.id), eq(schema.agentDecisions.agent, "watcher")));
  const deferredBefore = earlier.filter((d) => d.decision === "defer").map((d) => d.trigger as Anomaly);

  const decision: WatchDecision = llmConfigured()
    ? await runWatcher({
        anomaly: input.anomaly,
        mode: trip.mode,
        point: [input.lng, input.lat],
        accuracyM: input.accuracy,
        destLabel: trip.destLabel,
        offRouteM: input.offRouteM,
        stoppedMin: input.stoppedMin,
        lateMin: input.lateMin,
        remainingM: input.remainingM,
        vehicle: vehicleLine(trip),
        deferredBefore,
      })
    : { action: "check_in", message: "", reasons: ["The Guardian isn't set up on this server, so the standard check-in rule applied."], provider: "rules", model: null, ms: 0 };

  let notified = 0;
  if (decision.action === "escalate_early") {
    const recent = await db
      .select({ id: schema.agentDecisions.id })
      .from(schema.agentDecisions)
      .where(and(eq(schema.agentDecisions.tripId, trip.id), eq(schema.agentDecisions.decision, "escalate_early"), gte(schema.agentDecisions.createdAt, new Date(Date.now() - HEADS_UP_EVERY_MS))));
    if (!recent.length) {
      const contacts = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.userId, user.id));
      const results = await alertContacts(
        contacts.map((c) => c.id),
        {
          kind: "warning",
          tripId: trip.id,
          personUserId: user.id,
          title: `Heads-up: SafeNav is checking on ${user.name}`,
          body: `${decision.contactNote ?? `${user.name} ${TRIGGER_WORDS[input.anomaly].toLowerCase()} on the way to ${trip.destLabel}.`} SafeNav is asking them now and will send an SOS if they don't answer. Tap to follow live.`,
          url: `${baseUrl()}/t/${await serverShareToken(trip)}`,
          lat: input.lat,
          lng: input.lng,
        },
      ).catch(() => []);
      notified = new Set(results.filter((r) => r.ok).map((r) => r.contactId)).size;
    }
  }

  const steps = [
    { tool: "check_area", note: "Checked the streets where you are now", ms: 0, ok: true },
    ...(decision.action === "escalate_early" ? [{ tool: "notify_contacts", note: notified ? `Heads-up sent to ${notified} contact${notified === 1 ? "" : "s"}` : "Contacts already had a heads-up", ms: 0, ok: true }] : []),
  ];
  await recordDecision({
    userId: user.id,
    tripId: trip.id,
    agent: "watcher",
    trigger: input.anomaly,
    decision: decision.action,
    summary: decision.message || TRIGGER_WORDS[input.anomaly],
    reasons: decision.reasons,
    steps: decision.provider === "rules" ? [] : steps,
    provider: decision.provider,
    model: decision.model,
    ms: decision.ms,
  });

  return json({ decision: { ...decision, notified } });
});
