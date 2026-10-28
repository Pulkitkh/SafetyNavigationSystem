"use client";

import { Accessibility, Building2, Cctv, ChevronDown, Footprints, Info, Lightbulb, Shield, Store, TriangleAlert, Users } from "lucide-react";
import { useState } from "react";
import { formatDistance, formatDuration } from "@/lib/client/api";
import type { PlannedRoute } from "@/lib/safety/plan";
import { FACTOR_LABELS, FACTORS, scoreColor } from "@/lib/safety/factors";

const PERIOD_TEXT = {
  day: "Daylight: lighting isn't counted.",
  twilight: "Dusk/dawn: lighting starts to matter.",
  night: "After dark: lighting and open shops matter most.",
  late_night: "Late night: most shops are shut, so lighting and isolation dominate.",
} as const;

const BAND_TEXT = { good: "Safer", caution: "Use caution", avoid: "Avoid if possible" } as const;
const BAND_CLS = {
  good: "bg-green-50 text-green-800 ring-green-200",
  caution: "bg-amber-50 text-amber-900 ring-amber-200",
  avoid: "bg-red-50 text-red-800 ring-red-200",
} as const;

const TAG_TEXT = { recommended: "Recommended", safest: "Safest", fastest: "Fastest" } as const;

export function ScoreBadge({ score, size = 56 }: { score: number | null; size?: number }) {
  const color = scoreColor(score);
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-label={score == null ? "Not scored" : `Safety score ${score} out of 100`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ede9fe" strokeWidth="5" />
        {score != null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5" strokeDasharray={`${(score / 100) * c} ${c}`} strokeLinecap="round" />}
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none" style={{ color }}>
        <span className="text-base font-extrabold">{score ?? "—"}</span>
        {score != null && <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">safety</span>}
      </span>
    </div>
  );
}

function Stat({ icon: Icon, value, label }: { icon: typeof Lightbulb; value: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-2">
      <Icon className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
      <div className="min-w-0 leading-tight">
        <p className="text-sm font-semibold text-slate-900">{value}</p>
        <p className="truncate text-[11px] text-slate-500">{label}</p>
      </div>
    </div>
  );
}

export function RouteCard({
  route,
  selected,
  onSelect,
  mode,
  stepFree = false,
}: {
  route: PlannedRoute;
  selected: boolean;
  onSelect: () => void;
  mode: "walk" | "ride";
  stepFree?: boolean;
}) {
  const s = route.safety;
  const [why, setWhy] = useState(false);
  return (
    <article className={`card p-4 transition ${selected ? "ring-2 ring-brand-500" : ""}`} aria-current={selected ? "true" : undefined}>
      <button onClick={onSelect} className="flex w-full items-center gap-3 text-left">
        <ScoreBadge score={s?.score ?? null} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-lg font-bold text-slate-900">{formatDuration(route.duration)}</span>
            <span className="text-sm text-slate-500">{formatDistance(route.distance)}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {s && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${BAND_CLS[s.band]}`}>{BAND_TEXT[s.band]}</span>}
            {route.tags.map((t) => (
              <span key={t} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${t === "recommended" ? "brand-gradient text-white" : "bg-slate-100 text-slate-700"}`}>
                {TAG_TEXT[t]}
              </span>
            ))}
            {stepFree && s && (
              <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.stats.steps ? "bg-amber-100 text-amber-900" : "bg-violet-100 text-violet-900"}`}>
                <Accessibility className="h-3 w-3" aria-hidden />
                {s.stats.steps ? `${s.stats.steps} flight${s.stats.steps > 1 ? "s" : ""} of steps` : "No mapped steps"}
              </span>
            )}
          </div>
        </div>
      </button>

      {selected && s && (
        <div className="mt-4 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {s.weights.lighting > 0 && <Stat icon={Lightbulb} value={s.stats.litShare == null ? "Unmapped" : `${Math.round(s.stats.litShare * 100)}%`} label="lit stretches" />}
            <Stat icon={Footprints} value={`${Math.round(s.stats.footpathShare * 100)}%`} label="footpath" />
            <Stat icon={Store} value={String(s.stats.openPlaces)} label="places open" />
            <Stat icon={Building2} value={s.factors.frontage >= 60 ? "Busy" : s.factors.frontage >= 35 ? "Some" : "Few"} label="buildings facing" />
            <Stat icon={Shield} value={s.stats.nearestPoliceM == null ? "> 2 km" : formatDistance(s.stats.nearestPoliceM)} label="to police" />
            <Stat icon={s.stats.cctv ? Cctv : Users} value={s.stats.cctv ? String(s.stats.cctv) : String(s.stats.reportsNearby)} label={s.stats.cctv ? "CCTV mapped" : "user reports"} />
          </div>

          {s.highlights.length > 0 && (
            <ul className="space-y-1">
              {s.highlights.map((h) => (
                <li key={h} className="flex gap-2 text-slate-700">
                  <span className="text-good" aria-hidden>
                    ✓
                  </span>
                  {h}
                </li>
              ))}
            </ul>
          )}

          {s.weakStretches.length > 0 && (
            <div className="rounded-xl bg-red-50 p-3 ring-1 ring-red-100">
              <h3 className="flex items-center gap-1.5 font-semibold text-red-800">
                <TriangleAlert className="h-4 w-4" aria-hidden />
                Weak stretches
              </h3>
              <ul className="mt-1 space-y-1.5">
                {s.weakStretches.map((w) => (
                  <li key={w.from} className="text-red-900">
                    <span className="font-medium">
                      {formatDistance(w.length)} after {formatDistance(w.from)}
                    </span>
                    {w.reasons.length > 0 && <span className="text-red-800">: {w.reasons.join("; ")}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button onClick={() => setWhy((v) => !v)} aria-expanded={why} className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2 font-semibold text-slate-800">
            Why this score
            <ChevronDown className={`h-4 w-4 transition ${why ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {why && (
            <div className="space-y-2">
              <p className="text-slate-600">{PERIOD_TEXT[s.period]}</p>
              <ul className="space-y-1.5">
                {FACTORS.filter((f) => s.weights[f] > 0).map((f) => (
                  <li key={f}>
                    <div className="flex justify-between text-xs text-slate-600">
                      <span>
                        {FACTOR_LABELS[f]} <span className="text-slate-400">({Math.round(s.weights[f] * 100)}%)</span>
                      </span>
                      <span className="font-semibold text-slate-800">{s.factors[f]}</span>
                    </div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-slate-100">
                      <div className="h-1.5 rounded-full" style={{ width: `${s.factors[f]}%`, background: scoreColor(s.factors[f]) }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={`flex gap-2 rounded-xl p-3 text-xs ${s.confidence.level === "low" ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-600"}`}>
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">
                Map data confidence: {s.confidence.level} ({Math.round(s.confidence.coverage * 100)}%)
              </p>
              {s.confidence.notes.map((n) => (
                <p key={n} className="mt-0.5">
                  {n}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {selected && !s && mode === "walk" && <p className="mt-3 text-sm text-slate-600">Not scored. Directions and live monitoring still work.</p>}

      {selected && !s && mode === "ride" && (
        <p className="mt-3 text-sm text-slate-600">
          During the ride SafeNav watches for detours, long unexplained stops and late arrival, and asks if you&apos;re OK. Your contacts can follow the
          vehicle live.
        </p>
      )}
    </article>
  );
}
