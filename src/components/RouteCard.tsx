"use client";

import { Accessibility, Building2, Cctv, Check, ChevronDown, Footprints, Info, Lightbulb, Route, Shield, Store, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Badge, ScoreRing } from "@/components/ui";
import { formatDistance, formatDuration } from "@/lib/client/api";
import type { PlannedRoute } from "@/lib/safety/plan";
import { FACTOR_LABELS, FACTORS, scoreColor } from "@/lib/safety/factors";

const PERIOD_TEXT = {
  day: "Daylight: lighting isn't counted.",
  twilight: "Dusk or dawn: lighting starts to matter.",
  night: "After dark: lighting and open shops matter most.",
  late_night: "Late night: most shops are shut, so lighting and isolation dominate.",
} as const;

const BAND = {
  good: { text: "Safer", tone: "good" },
  caution: { text: "Use caution", tone: "caution" },
  avoid: { text: "Avoid if possible", tone: "danger" },
} as const;

const TAG_TEXT = { recommended: "Recommended", safest: "Safest", fastest: "Fastest" } as const;

const CONFIDENCE_TEXT = { high: "Well mapped", medium: "Partly mapped", low: "Thinly mapped", insufficient: "Not enough map data" } as const;

/** "4 min longer than the fastest, avoids a poorly lit stretch". */
function comparisonText(route: PlannedRoute): string | null {
  const c = route.vsFastest;
  if (!c || route.tags.includes("fastest")) return null;
  const mins = Math.round(c.extraS / 60);
  const time = mins > 0 ? `${mins} min longer than the fastest` : mins < 0 ? `${-mins} min quicker than the fastest` : "About as quick as the fastest";
  const safer = c.gain >= 3 ? `, ${c.gain} points safer` : c.gain <= -3 ? `, ${-c.gain} points less safe` : "";
  const avoids = c.avoids.length && c.gain > 0 ? `. Avoids: ${c.avoids.map((a) => a.toLowerCase()).join("; ")}` : "";
  return `${time}${safer}${avoids}`;
}

/** Kept for pages that still import the old name. */
export const ScoreBadge = ScoreRing;

function Stat({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return (
    <div className="card-inset flex items-center gap-2.5 px-3 py-2.5">
      <Icon className="h-[18px] w-[18px] shrink-0 text-brand-ink" aria-hidden />
      <div className="min-w-0 leading-tight">
        <p className="text-[15px] font-bold text-ink">{value}</p>
        <p className="text-xs text-ink-2">{label}</p>
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
  const insufficient = s?.confidence.level === "insufficient";
  const comparison = comparisonText(route);
  return (
    <article className={`card overflow-hidden transition-shadow ${selected ? "ring-2 ring-brand" : ""}`} aria-current={selected ? "true" : undefined}>
      <button onClick={onSelect} className="tap flex w-full items-center gap-3.5 p-4 text-left" aria-expanded={selected}>
        <ScoreRing score={s?.score ?? null} size={60} unknown={insufficient} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xl font-extrabold text-ink">{formatDuration(route.duration)}</span>
            <span className="text-sm font-medium text-ink-2">{formatDistance(route.distance)}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {s && !insufficient && <Badge tone={BAND[s.band].tone}>{BAND[s.band].text}</Badge>}
            {insufficient && <Badge tone="caution">Not enough map data</Badge>}
            {route.tags.map((t) => (
              <Badge key={t} tone={t === "recommended" ? "brand" : "neutral"}>
                {TAG_TEXT[t]}
              </Badge>
            ))}
            {route.source === "safety" && (
              <Badge tone="good" icon={Route}>
                Found by safety search
              </Badge>
            )}
            {stepFree && s && (
              <Badge tone={s.stats.steps ? "caution" : "brand"} icon={Accessibility}>
                {s.stats.steps ? `${s.stats.steps} flight${s.stats.steps > 1 ? "s" : ""} of steps` : "No mapped steps"}
              </Badge>
            )}
          </div>
          {s && !insufficient && s.range.hi - s.range.lo >= 6 && (
            <p className="mt-1.5 text-[13px] text-ink-2">
              Likely {s.range.lo}–{s.range.hi} · {CONFIDENCE_TEXT[s.confidence.level].toLowerCase()}
            </p>
          )}
          {comparison && <p className="mt-1 text-[13px] font-semibold text-ink">{comparison}</p>}
        </div>
        <ChevronDown className={`h-5 w-5 shrink-0 text-ink-3 transition-transform ${selected ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {selected && s && (
        <div className="fade-in space-y-3 px-4 pb-4 text-sm">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {s.weights.lighting > 0 && <Stat icon={Lightbulb} value={s.stats.litShare == null ? "Unmapped" : `${Math.round(s.stats.litShare * 100)}%`} label="lit stretches" />}
            <Stat icon={Footprints} value={`${Math.round(s.stats.footpathShare * 100)}%`} label="with footpath" />
            <Stat icon={Store} value={String(s.stats.openPlaces)} label="places open" />
            <Stat icon={Building2} value={s.factors.frontage >= 60 ? "Many" : s.factors.frontage >= 35 ? "Some" : "Few"} label="buildings facing" />
            <Stat icon={Shield} value={s.stats.nearestPoliceM == null ? "> 2 km" : formatDistance(s.stats.nearestPoliceM)} label="to police" />
            <Stat icon={s.stats.cctv ? Cctv : Users} value={s.stats.cctv ? String(s.stats.cctv) : String(s.stats.reportsNearby)} label={s.stats.cctv ? "CCTV mapped" : "user reports"} />
          </div>

          {s.highlights.length > 0 && (
            <ul className="space-y-1.5">
              {s.highlights.map((h) => (
                <li key={h} className="flex gap-2 text-ink">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-good" strokeWidth={3} aria-hidden />
                  {h}
                </li>
              ))}
            </ul>
          )}

          {s.weakStretches.length > 0 && (
            <div className="rounded-2xl bg-danger-soft p-3.5">
              <h3 className="flex items-center gap-1.5 font-bold text-danger">
                <TriangleAlert className="h-4 w-4" aria-hidden />
                {s.weakStretches.length === 1 ? "1 weak stretch" : `${s.weakStretches.length} weak stretches`}
              </h3>
              <ul className="mt-1.5 space-y-1.5 text-ink">
                {s.weakStretches.map((w) => (
                  <li key={w.from}>
                    <span className="font-semibold">
                      {formatDistance(w.length)} after {formatDistance(w.from)}
                    </span>
                    {w.reasons.length > 0 && <span className="text-ink-2">: {w.reasons.join("; ")}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button onClick={() => setWhy((v) => !v)} aria-expanded={why} className="card-inset tap flex min-h-12 w-full items-center justify-between px-3.5 font-bold text-ink">
            Why this score
            <ChevronDown className={`h-4 w-4 transition-transform ${why ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {why && (
            <div className="fade-in space-y-2.5">
              <p className="text-ink-2">{PERIOD_TEXT[s.period]}</p>
              <ul className="space-y-2">
                {FACTORS.filter((f) => s.weights[f] > 0).map((f) => (
                  <li key={f}>
                    <div className="flex justify-between gap-2 text-[13px] text-ink-2">
                      <span>
                        {FACTOR_LABELS[f]} <span className="text-ink-3">· {Math.round(s.weights[f] * 100)}%</span>
                      </span>
                      <span className="font-bold text-ink">{s.factors[f]}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-surface-3">
                      <div className="h-2 rounded-full" style={{ width: `${s.factors[f]}%`, background: scoreColor(s.factors[f]) }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={`flex gap-2.5 rounded-2xl p-3 text-[13px] ${s.confidence.level === "low" || insufficient ? "bg-caution-soft text-ink" : "bg-surface-2 text-ink-2"}`}>
            <Info className={`mt-0.5 h-4 w-4 shrink-0 ${s.confidence.level === "low" || insufficient ? "text-caution" : "text-ink-3"}`} aria-hidden />
            <div>
              <p className="font-bold">
                {CONFIDENCE_TEXT[s.confidence.level]}: score {insufficient ? "withheld" : s.score}, plausible range {s.range.lo}–{s.range.hi}
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

      {selected && !s && mode === "walk" && <p className="px-4 pb-4 text-sm text-ink-2">Not scored. Directions and live monitoring still work.</p>}

      {selected && !s && mode === "ride" && (
        <p className="px-4 pb-4 text-sm text-ink-2">
          During the ride SafeNav watches for detours, long unexplained stops and late arrival, and asks if you&apos;re OK. Your contacts can follow the
          vehicle live.
        </p>
      )}
    </article>
  );
}
