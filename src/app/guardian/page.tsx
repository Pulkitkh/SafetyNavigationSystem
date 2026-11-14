"use client";

import { BellRing, Check, ChevronDown, CircleAlert, CloudSun, Eye, Flag, ListChecks, Route, ScanSearch, Search, ShieldAlert, Siren, Sparkles, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/Nav";
import { Badge, EmptyState, type Tone } from "@/components/ui";
import { api, formatAgo } from "@/lib/client/api";
import { AGENT_LABEL, providerLabel, useGuardianEnabled, type GuardianDecision } from "@/lib/client/guardian";
import { useSession } from "@/lib/client/hooks";

const AGENT_STYLE: Record<GuardianDecision["agent"], { icon: LucideIcon; tone: Tone }> = {
  planner: { icon: Route, tone: "brand" },
  watcher: { icon: Eye, tone: "info" },
  escalation: { icon: ShieldAlert, tone: "danger" },
  triage: { icon: Flag, tone: "caution" },
};

const DECISION_LABEL: Record<string, { text: string; tone: Tone }> = {
  plan: { text: "Planned a route", tone: "brand" },
  asked: { text: "Asked a question", tone: "neutral" },
  defer: { text: "Held off", tone: "good" },
  check_in: { text: "Checked in", tone: "info" },
  escalate_early: { text: "Escalated early", tone: "danger" },
  brief_sent: { text: "Updated contacts", tone: "caution" },
  brief_sent_call_112: { text: "Updated contacts · advised 112", tone: "danger" },
  credible: { text: "Verified", tone: "good" },
  duplicate: { text: "Merged duplicate", tone: "neutral" },
  unclear: { text: "Marked unclear", tone: "caution" },
  abusive: { text: "Hidden: abuse", tone: "danger" },
  personal_info: { text: "Hidden: personal details", tone: "danger" },
};

const TRIGGER_LABEL: Record<string, string> = {
  request: "You asked",
  off_route: "Left the route",
  stopped: "Stopped moving",
  overdue: "Running late",
  sos: "SOS pressed",
  automatic_sos: "Automatic SOS",
  new_report: "New report",
};

const STEP_ICON: Record<string, LucideIcon> = {
  search_place: Search,
  check_area: ScanSearch,
  get_weather: CloudSun,
  plan_routes: Route,
  find_help: Siren,
  notify_contacts: BellRing,
  find_similar_reports: ListChecks,
};

const TONE_TEXT: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand-soft-ink",
  good: "bg-good-soft text-good",
  caution: "bg-caution-soft text-caution",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-surface-2 text-ink-2",
  sos: "bg-sos text-white",
};

function DecisionCard({ d }: { d: GuardianDecision }) {
  const [open, setOpen] = useState(false);
  const style = AGENT_STYLE[d.agent];
  const label = DECISION_LABEL[d.decision] ?? { text: d.decision.replace(/_/g, " "), tone: "neutral" as Tone };
  const Icon = style.icon;
  return (
    <li className="relative pl-12">
      <span className={`absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-xl ${TONE_TEXT[style.tone]}`} aria-hidden>
        <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </span>
      <article className="card p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-extrabold text-ink">{AGENT_LABEL[d.agent]}</span>
          <span className="text-[13px] text-ink-3">·</span>
          <span className="text-[13px] text-ink-2">{TRIGGER_LABEL[d.trigger] ?? d.trigger}</span>
          <span className="ml-auto text-xs text-ink-3">{formatAgo(d.createdAt)}</span>
        </div>
        <div className="mt-2">
          <Badge tone={label.tone}>{label.text}</Badge>
        </div>
        <p className="mt-2 text-[15px] leading-snug text-ink">{d.summary}</p>
        {d.reasons.length > 0 && (
          <ul className="mt-2.5 space-y-1 text-sm text-ink-2">
            {d.reasons.map((r) => (
              <li key={r} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-good" strokeWidth={3} aria-hidden />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}
        {d.steps.length > 0 && (
          <div className="mt-3 border-t border-line pt-2.5">
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-[13px] font-bold text-brand-ink">
              {d.steps.length} step{d.steps.length === 1 ? "" : "s"} taken
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
            </button>
            {open && (
              <ol className="mt-2 space-y-1.5">
                {d.steps.map((s, i) => {
                  const StepIcon = STEP_ICON[s.tool] ?? (s.ok ? Check : X);
                  return (
                    <li key={i} className="flex items-start gap-2 text-[13px] leading-snug text-ink-2">
                      <StepIcon className={`mt-0.5 h-4 w-4 shrink-0 ${s.ok ? "text-good" : "text-caution"}`} aria-hidden />
                      <span className="flex-1">{s.note}</span>
                      {s.ms > 0 && <span className="shrink-0 tabular-nums text-ink-3">{(s.ms / 1000).toFixed(1)} s</span>}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}
        <p className="mt-2.5 text-xs text-ink-3">
          Decided by {providerLabel(d.provider)}
          {d.model ? ` (${d.model})` : ""}
          {d.ms > 0 ? ` in ${(d.ms / 1000).toFixed(1)} s` : ""}
        </p>
      </article>
    </li>
  );
}

export default function GuardianPage() {
  const { me, loading } = useSession();
  const enabled = useGuardianEnabled();
  const [decisions, setDecisions] = useState<GuardianDecision[] | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTripId(new URLSearchParams(window.location.search).get("trip"));
  }, []);

  useEffect(() => {
    if (!me) return;
    let stop = false;
    const load = () =>
      api<{ decisions: GuardianDecision[] }>(`/api/agent/decisions${tripId ? `?tripId=${encodeURIComponent(tripId)}` : ""}`)
        .then(({ decisions }) => !stop && setDecisions(decisions))
        .catch((err) => !stop && setError((err as Error).message));
    void load();
    // Live: new decisions appear while a journey is under way.
    const id = setInterval(load, 10_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [me, tripId]);

  return (
    <main id="main" className="mx-auto max-w-lg pb-nav">
      <PageHeader title="Guardian activity" subtitle="What the Guardian agents decided for you, and why." icon={<Sparkles />} back={tripId ? "/journey" : undefined} />
      <div className="space-y-4 px-4">
        <section className="card p-4 text-sm text-ink-2" aria-label="How the Guardian works">
          <p className="font-bold text-ink">Four agents, one job: getting you there safely</p>
          <ul className="mt-2 space-y-1.5">
            <li>
              <b className="text-ink">Route planner</b> turns what you say into the safest route, checking the area, weather and open places.
            </li>
            <li>
              <b className="text-ink">Journey watcher</b> judges each alert in context: it checks in sooner on dark stretches and alerts contacts early when that&apos;s safer.
            </li>
            <li>
              <b className="text-ink">Escalation</b> follows every SOS with a situation update for your contacts: where you were, what the area is like, the nearest police.
            </li>
            <li>
              <b className="text-ink">Report triage</b> verifies community reports, merges duplicates and hides abuse.
            </li>
          </ul>
          <p className="mt-2.5 text-[13px]">SOS, check-ins and automatic SOS never depend on the Guardian: if it can&apos;t answer, SafeNav&apos;s safety rules apply as always.</p>
        </section>

        {tripId && (
          <div className="flex items-center justify-between gap-2 rounded-2xl bg-surface-2 px-4 py-2.5 text-sm text-ink-2">
            <span>Showing one journey</span>
            <button
              type="button"
              className="font-bold text-brand-ink"
              onClick={() => {
                setTripId(null);
                setDecisions(null);
                window.history.replaceState(null, "", "/guardian");
              }}
            >
              Show all
            </button>
          </div>
        )}

        {enabled === false && (
          <div className="card">
            <EmptyState icon={Sparkles} title="Guardian is off on this server" text="SafeNav's safety rules still check on every journey and send SOS. The Guardian agents start once a model key is configured." />
          </div>
        )}
        {!loading && !me && (
          <div className="card">
            <EmptyState
              icon={Sparkles}
              title="Sign in to see Guardian activity"
              text="Decisions are kept with your account."
              action={
                <Link href="/login?next=/guardian" className="btn btn-primary w-full">
                  Sign in
                </Link>
              }
            />
          </div>
        )}
        {error && (
          <p className="flex items-center gap-2 text-sm text-danger" role="alert">
            <CircleAlert className="h-4 w-4" aria-hidden />
            {error}
          </p>
        )}
        {me && decisions && decisions.length === 0 && enabled !== false && (
          <div className="card">
            <EmptyState
              icon={Sparkles}
              title="Nothing yet"
              text="Ask the Guardian to plan a journey, and every decision it makes will show here."
              action={
                <Link href="/" className="btn btn-primary w-full">
                  Ask the Guardian
                </Link>
              }
            />
          </div>
        )}
        {decisions && decisions.length > 0 && (
          <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[17px] before:top-2 before:w-0.5 before:bg-line" aria-label="Decisions, newest first">
            {decisions.map((d) => (
              <DecisionCard key={d.id} d={d} />
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}
