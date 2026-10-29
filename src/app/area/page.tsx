"use client";

import { Hospital, Fuel, Pill, MapPin, Navigation, RefreshCw, Share2, Shield, Timer, TriangleAlert, CircleCheck, Store } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Map, { type MapMarker } from "@/components/Map";
import { PageHeader } from "@/components/Nav";
import { Badge, Callout, IconTile, ScoreRing, SectionTitle } from "@/components/ui";
import { api, formatDistance } from "@/lib/client/api";
import { useGeolocation } from "@/lib/client/hooks";
import type { LngLat } from "@/lib/geo";
import type { AreaSafety, NearbyPlace } from "@/lib/safety/area";
import { FACTOR_LABELS, FACTORS, scoreColor } from "@/lib/safety/factors";
import { mapsLink } from "@/lib/sos";

const BAND = {
  good: { text: "Looks reasonably safe right now", cls: "text-good", tone: "good" },
  caution: { text: "Be careful here right now", cls: "text-caution", tone: "caution" },
  avoid: { text: "This spot looks unsafe right now", cls: "text-danger", tone: "danger" },
} as const;

const PERIOD = { day: "Daylight", twilight: "Dusk / dawn", night: "After dark", late_night: "Late night" } as const;

function placeIcon(kind: string) {
  if (kind === "police") return Shield;
  if (kind === "hospital" || kind === "clinic") return Hospital;
  if (kind === "pharmacy") return Pill;
  if (kind === "fuel") return Fuel;
  return Store;
}

function PlaceRow({ p, tag }: { p: NearbyPlace; tag?: string }) {
  const Icon = placeIcon(p.kind);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <IconTile icon={Icon} tone={p.kind === "police" ? "info" : p.kind === "hospital" || p.kind === "clinic" ? "danger" : "neutral"} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="break-words font-bold leading-snug text-ink">{p.name}</p>
        <p className="text-[13px] text-ink-2">
          {tag ? `${tag} · ` : ""}
          {formatDistance(p.distance)} away{p.openNow ? " · open now" : ""}
        </p>
      </div>
      <Link href={`/?to=${p.point[0]},${p.point[1]}&label=${encodeURIComponent(p.name)}`} aria-label={`Safest route to ${p.name}`} className="btn btn-secondary btn-sm shrink-0">
        <Navigation className="h-4 w-4" aria-hidden />
        Go
      </Link>
    </li>
  );
}

export default function AreaPage() {
  const geo = useGeolocation();
  const [point, setPoint] = useState<LngLat | null>(null);
  const [custom, setCustom] = useState(false);
  const [area, setArea] = useState<AreaSafety | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const here: LngLat | null = geo.fix ? [geo.fix.lng, geo.fix.lat] : null;
  useEffect(() => {
    if (!custom && here && !point) setPoint(here);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here?.[0], here?.[1]]);

  const check = useCallback(async (p: LngLat) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ area: AreaSafety; at: string }>(`/api/safety/area?lng=${p[0].toFixed(6)}&lat=${p[1].toFixed(6)}`);
      setArea(res.area);
      setCheckedAt(new Date(res.at));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (point) void check(point);
  }, [point, check]);

  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [];
    if (custom && point) m.push({ id: "spot", point, kind: "dest", label: "Checked spot" });
    if (area?.nearestPolice) m.push({ id: "police", point: area.nearestPolice.point, kind: "police", label: area.nearestPolice.name });
    if (area?.nearestHaven) m.push({ id: "haven", point: area.nearestHaven.point, kind: "safe", label: `${area.nearestHaven.name} (open)` });
    for (const p of area?.openNearby.slice(0, 6) ?? []) m.push({ id: p.id, point: p.point, kind: "place", label: p.name });
    return m;
  }, [area, point, custom]);

  const share = async () => {
    if (!point) return;
    const text = `My location: ${mapsLink(point[1], point[0])}`;
    try {
      await navigator.share({ title: "My location", text });
    } catch {
      await navigator.clipboard?.writeText(text).catch(() => {});
    }
  };

  return (
    <main id="main" className="mx-auto max-w-2xl pb-nav">
      <PageHeader title="Is it safe here?" subtitle="A live check of the streets around you, from real map data and the time right now." back="/safety" />
      <div className="space-y-4 px-4">
        <div className="card relative h-56 overflow-hidden p-0">
          <Map
            user={here ? { point: here, accuracy: geo.fix?.accuracy } : null}
            markers={markers}
            onMapClick={(p) => {
              setCustom(true);
              setPoint(p);
            }}
            fitKey={`${point?.join(",") ?? ""}-${area ? "a" : ""}`}
          />
          <p className="pointer-events-none absolute left-2 top-2 rounded-full bg-surface/95 px-3 py-1.5 text-[13px] font-bold text-ink shadow-card">Tap the map to check another spot</p>
        </div>

        {geo.error && !point && <Callout tone="caution">{geo.error}</Callout>}
        {error && !area && (
          <div className="card space-y-3 p-4 text-sm">
            <Callout tone="danger">{error}</Callout>
            <p className="text-ink-2">You can still set a safety timer, share your location or see nearby help and helplines.</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => point && check(point)} className="btn btn-primary btn-sm">
                <RefreshCw className="h-4 w-4" aria-hidden />
                Try again
              </button>
              <Link href="/timer" className="chip">
                <Timer className="h-4 w-4" aria-hidden />
                Safety timer
              </Link>
              <Link href="/help" className="chip">
                Nearby help
              </Link>
              <button onClick={share} className="chip">
                <Share2 className="h-4 w-4" aria-hidden />
                Share location
              </button>
            </div>
          </div>
        )}
        {error && area && <Callout tone="danger">{error}</Callout>}
        {loading && !area && (
          <div className="card flex items-center gap-4 p-4" aria-busy="true">
            <div className="h-[72px] w-[72px] shrink-0 animate-pulse rounded-full bg-surface-3" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-surface-3" />
              <p className="text-sm text-ink-2">Checking lights, open places, police and reports around you…</p>
            </div>
          </div>
        )}

        {area && (
          <>
            <section className="card rise p-4" aria-labelledby="verdict">
              <div className="flex items-center gap-4">
                <ScoreRing score={area.score} size={76} />
                <div className="min-w-0 flex-1">
                  <p id="verdict" className={`text-lg font-extrabold leading-snug ${BAND[area.band].cls}`}>
                    {BAND[area.band].text}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge tone="neutral">{PERIOD[area.period]}</Badge>
                    <Badge tone="neutral">{checkedAt?.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</Badge>
                    <Badge tone={area.confidence === "low" ? "caution" : "neutral"}>Map data {area.confidence}</Badge>
                    {custom && <Badge tone="brand">Chosen spot</Badge>}
                  </div>
                </div>
                <button
                  onClick={() => point && check(point)}
                  disabled={loading}
                  aria-label="Check again"
                  className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 disabled:opacity-50"
                >
                  <RefreshCw className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>
              {area.dataNote && (
                <div className="mt-3">
                  <Callout tone="caution">{area.dataNote}</Callout>
                </div>
              )}
              {(area.reasons.length > 0 || area.highlights.length > 0) && (
                <ul className="mt-3 space-y-2 text-[15px]">
                  {area.reasons.map((r) => (
                    <li key={r} className="flex gap-2 text-ink">
                      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
                      {r}
                    </li>
                  ))}
                  {area.highlights.map((h) => (
                    <li key={h} className="flex gap-2 text-ink">
                      <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-good" aria-hidden />
                      {h}
                    </li>
                  ))}
                </ul>
              )}
              <ul className="mt-4 space-y-2.5">
                {FACTORS.filter((f) => area.weights[f] > 0).map((f) => (
                  <li key={f}>
                    <div className="flex justify-between gap-3 text-[13px] text-ink-2">
                      <span>{FACTOR_LABELS[f]}</span>
                      <span className="font-bold text-ink">{area.factors[f]}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-surface-3">
                      <div className="h-2 rounded-full" style={{ width: `${area.factors[f]}%`, background: scoreColor(area.factors[f]) }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {(area.nearestHaven || area.nearestPolice) && (
              <section aria-labelledby="help-title">
                <SectionTitle id="help-title">Where to go for help</SectionTitle>
                <ul className="card divide-y divide-line overflow-hidden">
                  {area.nearestHaven && <PlaceRow p={area.nearestHaven} tag="Open safe spot" />}
                  {area.nearestPolice && <PlaceRow p={area.nearestPolice} tag="Nearest police" />}
                </ul>
              </section>
            )}

            {area.openNearby.length > 0 && (
              <section aria-labelledby="open-title">
                <SectionTitle id="open-title">Open near you now</SectionTitle>
                <ul className="card divide-y divide-line overflow-hidden">
                  {area.openNearby.slice(0, 6).map((p) => (
                    <PlaceRow key={p.id} p={p} />
                  ))}
                </ul>
              </section>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Link href="/timer" className="btn btn-outline">
                <Timer className="h-5 w-5 text-info" aria-hidden />
                Safety timer
              </Link>
              <button onClick={share} className="btn btn-outline">
                <Share2 className="h-5 w-5 text-brand-ink" aria-hidden />
                Share location
              </button>
              <Link href="/report" className="btn btn-outline col-span-2">
                <MapPin className="h-5 w-5 text-danger" aria-hidden />
                Something wrong here? Report it
              </Link>
            </div>
            <p className="px-1 text-[13px] text-ink-3">
              Based on OpenStreetMap, opening hours, the time of day and community reports within 200 m. It&apos;s guidance, not a guarantee: trust your
              instincts and call 112 in an emergency.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
