"use client";

import { Hospital, Fuel, Pill, MapPin, Navigation, RefreshCw, ScanSearch, Share2, Shield, Timer, TriangleAlert, CircleCheck, Store } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Map, { type MapMarker } from "@/components/Map";
import { PageHeader } from "@/components/Nav";
import { ScoreBadge } from "@/components/RouteCard";
import { api, formatDistance } from "@/lib/client/api";
import { useGeolocation } from "@/lib/client/hooks";
import type { LngLat } from "@/lib/geo";
import type { AreaSafety, NearbyPlace } from "@/lib/safety/area";
import { FACTOR_LABELS, FACTORS, scoreColor } from "@/lib/safety/factors";
import { mapsLink } from "@/lib/sos";

const BAND = {
  good: { text: "Looks reasonably safe right now", cls: "text-green-700" },
  caution: { text: "Be careful here right now", cls: "text-amber-700" },
  avoid: { text: "This spot looks unsafe right now", cls: "text-red-700" },
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
    <li className="flex items-center gap-3 py-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{p.name}</p>
        <p className="text-xs text-slate-500">
          {tag ? `${tag} · ` : ""}
          {formatDistance(p.distance)} away{p.openNow ? " · open now" : ""}
        </p>
      </div>
      <Link
        href={`/?to=${p.point[0]},${p.point[1]}&label=${encodeURIComponent(p.name)}`}
        className="flex shrink-0 items-center gap-1 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"
      >
        <Navigation className="h-3.5 w-3.5" aria-hidden />
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
    <main className="mx-auto max-w-2xl pb-nav">
      <PageHeader title="Is it safe here?" subtitle="A live check of the streets around you, from real map data and the time right now." icon={<ScanSearch />} />
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
          <p className="pointer-events-none absolute inset-x-2 bottom-2 rounded-lg bg-white/90 px-2 py-1 text-center text-[11px] text-slate-600 shadow">
            Tap the map to check another spot
          </p>
        </div>

        {geo.error && !point && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{geo.error}</p>}
        {error && !area && (
          <div className="card space-y-3 p-4 text-sm">
            <p className="text-red-800">{error}</p>
            <p className="text-slate-600">You can still set a safety timer, share your location or see nearby help and helplines.</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => point && check(point)} className="rounded-full bg-brand-600 px-3 py-1.5 font-semibold text-white">
                Try again
              </button>
              <Link href="/timer" className="rounded-full bg-sky-50 px-3 py-1.5 font-semibold text-sky-800">
                Safety timer
              </Link>
              <Link href="/help" className="rounded-full bg-amber-50 px-3 py-1.5 font-semibold text-amber-900">
                Nearby help
              </Link>
              <button onClick={share} className="rounded-full bg-slate-100 px-3 py-1.5 font-semibold text-slate-800">
                Share location
              </button>
            </div>
          </div>
        )}
        {error && area && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {loading && !area && (
          <div className="card flex items-center gap-3 p-4 text-sm text-slate-600">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500" aria-hidden />
            Checking lights, open places, police and reports around you…
          </div>
        )}

        {area && (
          <>
            <section className="card p-4">
              <div className="flex items-center gap-4">
                <ScoreBadge score={area.score} size={72} />
                <div className="min-w-0 flex-1">
                  <p className={`text-base font-bold ${BAND[area.band].cls}`}>{BAND[area.band].text}</p>
                  <p className="text-xs text-slate-500">
                    {PERIOD[area.period]} · checked {checkedAt?.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} · map data {area.confidence}
                    {custom ? " · chosen spot" : ""}
                  </p>
                </div>
                <button
                  onClick={() => point && check(point)}
                  disabled={loading}
                  aria-label="Check again"
                  className="rounded-full p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                >
                  <RefreshCw className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>
              {(area.reasons.length > 0 || area.highlights.length > 0) && (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {area.reasons.map((r) => (
                    <li key={r} className="flex gap-2 text-red-800">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      {r}
                    </li>
                  ))}
                  {area.highlights.map((h) => (
                    <li key={h} className="flex gap-2 text-green-800">
                      <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      {h}
                    </li>
                  ))}
                </ul>
              )}
              <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
                {FACTORS.filter((f) => area.weights[f] > 0).map((f) => (
                  <li key={f}>
                    <div className="flex justify-between text-[11px] text-slate-600">
                      <span className="truncate">{FACTOR_LABELS[f]}</span>
                      <span className="font-semibold text-slate-800">{area.factors[f]}</span>
                    </div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-slate-100">
                      <div className="h-1.5 rounded-full" style={{ width: `${area.factors[f]}%`, background: scoreColor(area.factors[f]) }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {(area.nearestHaven || area.nearestPolice) && (
              <section className="card px-4 py-2">
                <h2 className="pt-2 text-sm font-semibold text-slate-900">Where to go for help</h2>
                <ul className="divide-y divide-slate-100">
                  {area.nearestHaven && <PlaceRow p={area.nearestHaven} tag="Open safe spot" />}
                  {area.nearestPolice && <PlaceRow p={area.nearestPolice} tag="Nearest police" />}
                </ul>
              </section>
            )}

            {area.openNearby.length > 0 && (
              <section className="card px-4 py-2">
                <h2 className="pt-2 text-sm font-semibold text-slate-900">Open near you now</h2>
                <ul className="divide-y divide-slate-100">
                  {area.openNearby.slice(0, 6).map((p) => (
                    <PlaceRow key={p.id} p={p} />
                  ))}
                </ul>
              </section>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Link href="/timer" className="card flex items-center gap-2 p-3 text-sm font-semibold text-slate-800">
                <Timer className="h-5 w-5 text-sky-600" aria-hidden />
                Safety timer
              </Link>
              <button onClick={share} className="card flex items-center gap-2 p-3 text-left text-sm font-semibold text-slate-800">
                <Share2 className="h-5 w-5 text-brand-600" aria-hidden />
                Share location
              </button>
              <Link href="/report" className="card col-span-2 flex items-center gap-2 p-3 text-sm font-semibold text-slate-800">
                <MapPin className="h-5 w-5 text-rose-600" aria-hidden />
                Something wrong here? Report it for others
              </Link>
            </div>
            <p className="text-xs text-slate-500">
              Based on OpenStreetMap, opening hours, the time of day and community reports within 200 m. It&apos;s guidance, not a guarantee: trust your
              instincts and call 112 in an emergency.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
