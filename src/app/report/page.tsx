"use client";

import { Beer, CircleAlert, CloudFog, Construction, Dog, Footprints, Lightbulb, ShieldCheck, ShoppingBag, Sparkles, ThumbsDown, ThumbsUp, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Map, { type MapMarker } from "@/components/Map";
import { PageHeader } from "@/components/Nav";
import { Callout } from "@/components/ui";
import { api, formatAgo } from "@/lib/client/api";
import { useGeolocation, useSession } from "@/lib/client/hooks";
import { haversine, type LngLat } from "@/lib/geo";
import { REPORT_CATEGORIES, reportCategory } from "@/lib/reports";

interface Report {
  id: string;
  category: string;
  lat: number;
  lng: number;
  note: string | null;
  observedAt: string;
  upvotes: number;
  flags: number;
}

/** One icon family everywhere; the category data's emoji are not shown. */
const CATEGORY_ICON: Record<string, LucideIcon> = {
  harassment: TriangleAlert,
  stalking: Footprints,
  snatching: ShoppingBag,
  unsafe_crowd: Beer,
  deserted: CloudFog,
  poor_lighting: Lightbulb,
  stray_dogs: Dog,
  bad_footpath: Construction,
  other: CircleAlert,
  well_lit: Sparkles,
  busy_safe: Users,
  police_presence: ShieldCheck,
};

const RADIUS_DEG = 0.012; // ~1.3 km around the selected point

export default function ReportPage() {
  const { me } = useSession();
  const geo = useGeolocation();
  const [point, setPoint] = useState<LngLat | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [earlier, setEarlier] = useState(false);
  const [when, setWhen] = useState("");
  const [reports, setReports] = useState<Report[]>([]);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!point && geo.fix) setPoint([geo.fix.lng, geo.fix.lat]);
  }, [geo.fix, point]);

  const load = useCallback(async (p: LngLat) => {
    const bbox = [p[0] - RADIUS_DEG, p[1] - RADIUS_DEG, p[0] + RADIUS_DEG, p[1] + RADIUS_DEG].map((n) => n.toFixed(5)).join(",");
    try {
      const { reports } = await api<{ reports: Report[] }>(`/api/reports?bbox=${bbox}`);
      setReports(reports);
    } catch {
      setReports([]);
    }
  }, []);

  useEffect(() => {
    if (point) void load(point);
  }, [point, load]);

  const submit = async () => {
    if (!point || !category) return;
    setBusy(true);
    setStatus(null);
    try {
      await api("/api/reports", {
        method: "POST",
        json: { category, lat: point[1], lng: point[0], note: note.trim() || undefined, observedAt: earlier && when ? new Date(when).toISOString() : undefined },
      });
      setStatus({ kind: "ok", text: "Thank you. Your report now helps others plan safer routes." });
      setCategory(null);
      setNote("");
      setEarlier(false);
      await load(point);
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const vote = async (id: string, value: 1 | -1) => {
    try {
      const res = await api<{ upvotes: number; flags: number; hidden: boolean }>(`/api/reports/${id}/vote`, { method: "POST", json: { value } });
      setReports((rs) => (res.hidden ? rs.filter((r) => r.id !== id) : rs.map((r) => (r.id === id ? { ...r, upvotes: res.upvotes, flags: res.flags } : r))));
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    }
  };

  const markers: MapMarker[] = useMemo(
    () => [
      ...(point ? [{ id: "pick", point, kind: "dest" as const, label: "Report location" }] : []),
      ...reports.map((r) => ({ id: r.id, point: [r.lng, r.lat] as LngLat, kind: "report" as const, label: reportCategory(r.category)?.label })),
    ],
    [point, reports],
  );

  const nearby = point ? [...reports].sort((a, b) => haversine(point, [a.lng, a.lat]) - haversine(point, [b.lng, b.lat])) : reports;

  const concerns = REPORT_CATEGORIES.filter((c) => c.severity > 0);
  const positives = REPORT_CATEGORIES.filter((c) => c.severity < 0);
  const categoryButton = (c: (typeof REPORT_CATEGORIES)[number]) => {
    const Icon = CATEGORY_ICON[c.id] ?? CircleAlert;
    const on = category === c.id;
    return (
      <button
        key={c.id}
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => setCategory(c.id)}
        className={`flex min-h-14 items-center gap-2.5 rounded-2xl px-3 py-2 text-left text-sm font-semibold leading-snug transition-colors ${
          on ? "bg-brand-soft text-brand-soft-ink ring-2 ring-brand" : "bg-surface text-ink ring-1 ring-line hover:bg-surface-2"
        }`}
      >
        <Icon className={`h-5 w-5 shrink-0 ${on ? "" : c.severity < 0 ? "text-good" : "text-danger"}`} aria-hidden />
        {c.label}
      </button>
    );
  };

  return (
    <main id="main" className="flex h-dvh flex-col md:flex-row">
      <section className="relative h-[34dvh] md:order-2 md:h-auto md:flex-1" aria-label="Map">
        <Map markers={markers} onMapClick={setPoint} fitKey={point ? "p" : "none"} user={geo.fix ? { point: [geo.fix.lng, geo.fix.lat], accuracy: geo.fix.accuracy } : null} />
        <p className="pointer-events-none absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] rounded-full bg-surface/95 px-3 py-1.5 text-[13px] font-bold text-ink shadow-card">
          Tap the map to set the exact spot
        </p>
      </section>

      <section className="sheet relative z-10 -mt-6 flex-1 overflow-y-auto bg-canvas pb-nav md:order-1 md:mt-0 md:w-[440px] md:flex-none">
        <PageHeader title="Report a safety concern" subtitle="Anonymous to other users. Reports fade over time unless others confirm them." back="/safety" />
        <div className="space-y-5 px-4">
          <fieldset>
            <legend className="label">What&apos;s the concern?</legend>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Concern">
              {concerns.map(categoryButton)}
            </div>
          </fieldset>
          <fieldset>
            <legend className="label">Or something good about this place</legend>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Positive">
              {positives.map(categoryButton)}
            </div>
          </fieldset>

          <div>
            <label htmlFor="r-note" className="label">
              Details <span className="font-normal text-ink-3">(optional)</span>
            </label>
            <textarea
              id="r-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={280}
              rows={2}
              placeholder="What happened? Don't include names or personal details."
              className="field"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-pressed={earlier} onClick={() => setEarlier((v) => !v)} className="chip">
              It happened earlier
            </button>
            {earlier && <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="field min-h-10 min-w-0 flex-1 rounded-full py-2 text-sm" aria-label="When it happened" />}
          </div>

          {me ? (
            <button onClick={submit} disabled={!point || !category || busy} className="btn btn-primary w-full">
              {busy ? "Submitting…" : "Submit report"}
            </button>
          ) : (
            <Link href="/login?next=/report" className="btn btn-primary w-full">
              Sign in to report
            </Link>
          )}
          {status && <Callout tone={status.kind === "ok" ? "good" : "danger"}>{status.text}</Callout>}

          <section aria-labelledby="nearby-title">
            <h2 id="nearby-title" className="mb-2 px-1 text-base font-extrabold text-ink">
              Reports nearby
            </h2>
            {nearby.length === 0 && <p className="px-1 text-sm text-ink-2">No reports within about a kilometre.</p>}
            <ul className="space-y-2">
              {nearby.slice(0, 20).map((r) => {
                const cat = reportCategory(r.category);
                const Icon = CATEGORY_ICON[r.category] ?? CircleAlert;
                return (
                  <li key={r.id} className="card p-3.5 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="flex items-center gap-2 font-bold text-ink">
                        <Icon className={`h-4 w-4 shrink-0 ${cat && cat.severity < 0 ? "text-good" : "text-danger"}`} aria-hidden />
                        {cat?.label ?? r.category}
                      </span>
                      <span className="shrink-0 text-xs text-ink-3">{formatAgo(r.observedAt)}</span>
                    </div>
                    {r.note && <p className="mt-1 text-ink-2">{r.note}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                      {point && <span>{Math.round(haversine(point, [r.lng, r.lat]))} m away</span>}
                      <button onClick={() => vote(r.id, 1)} disabled={!me} className="chip min-h-9 py-1 text-[13px] disabled:opacity-40">
                        <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
                        Confirm ({r.upvotes})
                      </button>
                      <button onClick={() => vote(r.id, -1)} disabled={!me} className="chip min-h-9 py-1 text-[13px] disabled:opacity-40">
                        <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
                        Not accurate
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </section>
    </main>
  );
}
