"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Map, { type MapMarker } from "@/components/Map";
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

  return (
    <main className="flex h-dvh flex-col md:flex-row">
      <section className="relative h-[38dvh] md:order-2 md:h-auto md:flex-1">
        <Map markers={markers} onMapClick={setPoint} fitKey={point ? "p" : "none"} user={geo.fix ? { point: [geo.fix.lng, geo.fix.lat], accuracy: geo.fix.accuracy } : null} />
        <p className="pointer-events-none absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] rounded-full bg-white/90 px-3 py-1 text-xs text-slate-700 shadow">
          Tap the map to set the exact spot
        </p>
      </section>

      <section className="flex-1 space-y-4 overflow-y-auto bg-slate-50 p-4 pb-nav md:order-1 md:w-[420px] md:flex-none">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Report a safety concern</h1>
          <p className="text-sm text-slate-600">Reports are anonymous to other users and fade over time unless others confirm them.</p>
        </div>

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What happened">
          {REPORT_CATEGORIES.map((c) => (
            <button
              key={c.id}
              role="radio"
              aria-checked={category === c.id}
              onClick={() => setCategory(c.id)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm ${
                category === c.id ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-700"
              } ${c.severity < 0 ? "border-dashed" : ""}`}
            >
              <span aria-hidden>{c.emoji}</span>
              {c.label}
            </button>
          ))}
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={280}
          rows={2}
          placeholder="Details (optional). Don't include names or personal information."
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          aria-label="Details"
        />

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={earlier} onChange={(e) => setEarlier(e.target.checked)} /> It happened earlier
          </label>
          {earlier && <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1" aria-label="When it happened" />}
        </div>

        {me ? (
          <button onClick={submit} disabled={!point || !category || busy} className="w-full rounded-xl bg-brand-600 py-2.5 font-semibold text-white disabled:opacity-50">
            {busy ? "Submitting…" : "Submit report"}
          </button>
        ) : (
          <Link href="/login?next=/report" className="block rounded-xl bg-brand-600 py-2.5 text-center font-semibold text-white">
            Sign in to report
          </Link>
        )}
        {status && <p className={`rounded-xl p-3 text-sm ${status.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>{status.text}</p>}

        <div>
          <h2 className="mb-2 font-semibold text-slate-900">Reports nearby</h2>
          {nearby.length === 0 && <p className="text-sm text-slate-500">No reports within about a kilometre.</p>}
          <ul className="space-y-2">
            {nearby.slice(0, 20).map((r) => {
              const cat = reportCategory(r.category);
              return (
                <li key={r.id} className="rounded-xl bg-white p-3 text-sm shadow-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-slate-900">
                      {cat?.emoji} {cat?.label ?? r.category}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">{formatAgo(r.observedAt)}</span>
                  </div>
                  {r.note && <p className="mt-1 text-slate-600">{r.note}</p>}
                  <div className="mt-2 flex items-center gap-3 text-xs text-slate-600">
                    {point && <span>{Math.round(haversine(point, [r.lng, r.lat]))} m away</span>}
                    <button onClick={() => vote(r.id, 1)} disabled={!me} className="text-green-700 disabled:opacity-40">
                      ✓ Confirm ({r.upvotes})
                    </button>
                    <button onClick={() => vote(r.id, -1)} disabled={!me} className="text-slate-500 disabled:opacity-40">
                      Not accurate
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </main>
  );
}
