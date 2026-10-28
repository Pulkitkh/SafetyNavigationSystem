"use client";

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

const TAG_TEXT = { recommended: "Recommended", safest: "Safest", fastest: "Fastest" } as const;

export function ScoreBadge({ score, size = 48 }: { score: number | null; size?: number }) {
  const color = scoreColor(score);
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-label={score == null ? "Not scored" : `Safety score ${score} out of 100`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="4" />
        {score != null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeDasharray={`${(score / 100) * c} ${c}`} strokeLinecap="round" />}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold" style={{ color }}>
        {score ?? "—"}
      </span>
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
  return (
    <article
      className={`rounded-2xl border bg-white p-4 transition ${selected ? "border-brand-500 shadow-md ring-1 ring-brand-500" : "border-slate-200"}`}
      aria-current={selected ? "true" : undefined}
    >
      <button onClick={onSelect} className="flex w-full items-center gap-3 text-left">
        <ScoreBadge score={s?.score ?? null} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-base font-semibold text-slate-900">{formatDuration(route.duration)}</span>
            <span className="text-sm text-slate-500">· {formatDistance(route.distance)}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {s && (
              <span className="rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: scoreColor(s.score) }}>
                {BAND_TEXT[s.band]}
              </span>
            )}
            {stepFree && s && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.stats.steps ? "bg-amber-100 text-amber-900" : "bg-violet-100 text-violet-900"}`}>
                {s.stats.steps ? `${s.stats.steps} flight${s.stats.steps > 1 ? "s" : ""} of steps` : "No mapped steps"}
              </span>
            )}
            {route.tags.map((t) => (
              <span key={t} className={`rounded-full px-2 py-0.5 text-xs font-medium ${t === "recommended" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"}`}>
                {TAG_TEXT[t]}
              </span>
            ))}
          </div>
        </div>
      </button>

      {selected && s && (
        <div className="mt-4 space-y-4 text-sm">
          <p className="text-slate-600">{PERIOD_TEXT[s.period]}</p>

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
            <div className="rounded-xl bg-red-50 p-3">
              <h3 className="font-semibold text-red-800">Weak stretches</h3>
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

          <div>
            <h3 className="mb-2 font-semibold text-slate-800">Why this score</h3>
            <ul className="space-y-1.5">
              {FACTORS.filter((f) => s.weights[f] > 0).map((f) => (
                <li key={f}>
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>
                      {FACTOR_LABELS[f]} <span className="text-slate-400">({Math.round(s.weights[f] * 100)}%)</span>
                    </span>
                    <span className="font-medium text-slate-800">{s.factors[f]}</span>
                  </div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full" style={{ width: `${s.factors[f]}%`, background: scoreColor(s.factors[f]) }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className={`rounded-xl p-3 ${s.confidence.level === "low" ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-700"}`}>
            <p className="font-medium">
              Map data confidence: {s.confidence.level} ({Math.round(s.confidence.coverage * 100)}%)
            </p>
            {s.confidence.notes.map((n) => (
              <p key={n} className="mt-1 text-xs">
                {n}
              </p>
            ))}
          </div>
        </div>
      )}

      {selected && !s && mode === "walk" && (
        <p className="mt-3 text-sm text-slate-600">Not scored. Directions and live monitoring still work.</p>
      )}

      {selected && !s && mode === "ride" && (
        <p className="mt-3 text-sm text-slate-600">
          During the ride SafeNav watches for detours, long unexplained stops and late arrival, and asks if you&apos;re OK. Your contacts can follow the
          vehicle live.
        </p>
      )}
    </article>
  );
}
