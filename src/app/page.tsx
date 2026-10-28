"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Map, { type MapMarker, type MapRoute } from "@/components/Map";
import { PlaceSearch, type PlaceValue } from "@/components/PlaceSearch";
import { RouteCard } from "@/components/RouteCard";
import { api, newShareToken } from "@/lib/client/api";
import { useGeolocation, usePrefs, useSession } from "@/lib/client/hooks";
import { store } from "@/lib/client/store";
import type { LngLat } from "@/lib/geo";
import { VEHICLE_LABELS, VEHICLE_TYPES, type VehicleType } from "@/lib/phone";
import type { PlanResult } from "@/lib/safety/plan";

type Mode = "walk" | "ride";

function localDateTimeValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PlanPage() {
  const router = useRouter();
  const { me } = useSession();
  const [prefs, setPrefs] = usePrefs();
  const geo = useGeolocation();
  const here: LngLat | null = geo.fix ? [geo.fix.lng, geo.fix.lat] : null;

  const [from, setFrom] = useState<PlaceValue | null>(null);
  const [to, setTo] = useState<PlaceValue | null>(null);
  const [mode, setMode] = useState<Mode>("walk");
  const [leaveLater, setLeaveLater] = useState(false);
  const [departLocal, setDepartLocal] = useState(() => localDateTimeValue(new Date(Date.now() + 30 * 60_000)));
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<{ type: VehicleType; plate: string; note: string }>({ type: "cab", plate: "", note: "" });
  const [starting, setStarting] = useState(false);
  const [activeJourney, setActiveJourney] = useState(false);

  useEffect(() => setActiveJourney(!!store.journey()), []);

  // Deep link from the Help page or elsewhere: /?to=lng,lat&label=Name
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const [lng, lat] = (q.get("to") ?? "").split(",").map(Number);
    if (Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      setTo({ label: q.get("label")?.slice(0, 120) || "Destination", point: [lng, lat] });
    }
  }, []);

  // Default the start to the current location once GPS is available.
  useEffect(() => {
    if (!from && here) setFrom({ label: "Your current location", point: here, current: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here?.[0], here?.[1]]);

  const findRoutes = async () => {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    setPlan(null);
    try {
      const startPoint = from.current && here ? here : from.point;
      const departAt = leaveLater ? new Date(departLocal).toISOString() : undefined;
      const result = await api<PlanResult>("/api/routes/plan", { method: "POST", json: { from: startPoint, to: to.point, mode, departAt, stepFree: mode === "walk" && prefs.stepFree } });
      setPlan(result);
      setSelectedId(result.routes[0]?.id ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const selected = plan?.routes.find((r) => r.id === selectedId) ?? plan?.routes[0] ?? null;

  const mapRoutes: MapRoute[] = useMemo(
    () =>
      (plan?.routes ?? []).map((r) => ({
        id: r.id,
        coordinates: r.coordinates,
        segments: r.safety?.segments.map((s) => ({ coordinates: s.coordinates, score: s.score })),
      })),
    [plan],
  );

  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [];
    if (to) m.push({ id: "dest", point: to.point, kind: "dest", label: to.label });
    if (from && !from.current) m.push({ id: "start", point: from.point, kind: "start", label: from.label });
    for (const w of selected?.safety?.weakStretches ?? []) m.push({ id: `w${w.from}`, point: w.center, kind: "weak", label: w.reasons.join("; ") || "Weak stretch" });
    return m;
  }, [from, to, selected]);

  const startJourney = async () => {
    if (!selected || !to) return;
    if (!me) {
      router.push("/login?next=/");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const shareToken = newShareToken();
      const body = {
        shareToken,
        mode,
        destLabel: to.label,
        dest: to.point,
        route: selected.coordinates,
        durationS: selected.duration,
        ...(mode === "ride" ? { vehicleType: vehicle.type, vehiclePlate: vehicle.plate || undefined, vehicleNote: vehicle.note || undefined } : {}),
      };
      const { trip } = await api<{ trip: { id: string; expectedArrival: string } }>("/api/trips", { method: "POST", json: body });
      store.setJourney({
        tripId: trip.id,
        shareToken,
        mode,
        destLabel: to.label,
        dest: to.point,
        route: selected.coordinates,
        steps: selected.steps.map((s) => ({ instruction: s.instruction, distance: s.distance, location: s.location })),
        expectedArrival: new Date(trip.expectedArrival).getTime(),
        vehicle: mode === "ride" ? [VEHICLE_LABELS[vehicle.type], vehicle.plate.toUpperCase()].filter(Boolean).join(" ") : null,
        startedAt: Date.now(),
      });
      router.push("/journey?new=1");
    } catch (err) {
      setError((err as Error).message);
      setStarting(false);
    }
  };

  return (
    <main className="flex h-dvh flex-col md:flex-row">
      <section className="relative order-2 flex max-h-[62dvh] flex-col overflow-y-auto bg-slate-50 pb-nav md:order-1 md:max-h-none md:w-[420px] md:shrink-0 md:border-r md:border-slate-200">
        <div className="sticky top-0 z-20 space-y-2 bg-slate-50 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-slate-900">
              Safe<span className="text-brand-600">Nav</span>
            </h1>
            <Link href={me ? "/account" : "/login"} className="text-sm font-medium text-brand-600">
              {me ? me.name.split(" ")[0] : "Sign in"}
            </Link>
          </div>

          {activeJourney && (
            <Link href="/journey" className="block rounded-xl bg-green-600 px-3 py-2 text-sm font-medium text-white">
              Journey in progress — tap to return
            </Link>
          )}

          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200 p-1 text-sm font-medium" role="tablist" aria-label="Travel mode">
            {(["walk", "ride"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setPlan(null);
                }}
                className={`rounded-lg py-1.5 ${mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
              >
                {m === "walk" ? "Walk" : "Cab / Auto ride"}
              </button>
            ))}
          </div>

          <PlaceSearch label="Start" placeholder="Start: search a place" value={from} onChange={setFrom} near={here} allowCurrent currentPoint={here} />
          <PlaceSearch label="Destination" placeholder="Where to?" value={to} onChange={setTo} near={here ?? from?.point} />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {mode === "walk" && (
              <label className="flex items-center gap-1.5 text-slate-700">
                <input
                  type="checkbox"
                  checked={prefs.stepFree}
                  onChange={(e) => {
                    setPrefs({ stepFree: e.target.checked });
                    setPlan(null);
                  }}
                  className="h-4 w-4"
                />
                Step-free
              </label>
            )}
            <label className="flex items-center gap-1.5 text-slate-700">
              <input type="checkbox" checked={leaveLater} onChange={(e) => setLeaveLater(e.target.checked)} className="h-4 w-4" />
              Leave later
            </label>
            {leaveLater && (
              <input
                type="datetime-local"
                value={departLocal}
                onChange={(e) => setDepartLocal(e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1"
                aria-label="Departure time"
              />
            )}
          </div>

          <button
            onClick={findRoutes}
            disabled={!from || !to || loading}
            className="w-full rounded-xl bg-brand-600 py-2.5 font-semibold text-white disabled:opacity-50"
          >
            {loading ? (mode === "walk" ? "Checking streets, lights and shops…" : "Finding route…") : mode === "walk" ? "Find safest route" : "Plan ride"}
          </button>
          {geo.error && !from && <p className="text-xs text-amber-800">{geo.error}</p>}
        </div>

        <div className="space-y-3 px-4 pb-4">
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {plan?.dataNote && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{plan.dataNote}</p>}
          {plan?.weather && <WeatherNote weather={plan.weather} later={leaveLater} />}
          {plan?.stepFree && (
            <p className="rounded-xl bg-violet-50 p-3 text-sm text-violet-900">
              Step-free: routes with steps, unpaved or rough surfaces are ranked last. OpenStreetMap may not map every kerb or ramp.
            </p>
          )}

          {plan?.routes.map((r) => (
            <RouteCard key={r.id} route={r} selected={r.id === selected?.id} onSelect={() => setSelectedId(r.id)} mode={plan.mode} stepFree={plan.stepFree} />
          ))}

          {plan && selected && (
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
              {plan.mode === "ride" && (
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-semibold text-slate-800">Vehicle details (shared with your contacts)</legend>
                  <select
                    value={vehicle.type}
                    onChange={(e) => setVehicle((v) => ({ ...v, type: e.target.value as VehicleType }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    aria-label="Vehicle type"
                  >
                    {VEHICLE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {VEHICLE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  <input
                    value={vehicle.plate}
                    onChange={(e) => setVehicle((v) => ({ ...v, plate: e.target.value }))}
                    placeholder="Number plate, e.g. MP09 AB 1234"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase"
                    aria-label="Number plate"
                    autoCapitalize="characters"
                  />
                  <input
                    value={vehicle.note}
                    onChange={(e) => setVehicle((v) => ({ ...v, note: e.target.value }))}
                    placeholder="Driver name / app booking ID (optional)"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    aria-label="Driver or booking details"
                    maxLength={120}
                  />
                </fieldset>
              )}
              <button onClick={startJourney} disabled={starting} className="w-full rounded-xl bg-green-600 py-3 font-semibold text-white disabled:opacity-50">
                {starting ? "Starting…" : me ? (plan.mode === "ride" ? "Start ride monitoring" : "Start journey & share live") : "Sign in to start a monitored journey"}
              </button>
              <p className="text-xs text-slate-500">
                Your contacts get a live link. SafeNav checks in if you stop, leave the route or are late, and sends SOS if you don&apos;t answer.
              </p>
            </div>
          )}

          {!plan && !loading && (
            <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              <p className="font-medium text-slate-800">How routes are scored</p>
              <p className="mt-1">
                Each 100 m of a walk is rated from OpenStreetMap data: street lights, footpaths, shops open at that hour, isolated land like industrial
                areas or parks at night, distance to police and hospitals, and recent reports from other users.{" "}
                <Link href="/about" className="text-brand-600 underline">
                  Learn more
                </Link>
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="relative order-1 min-h-[38dvh] flex-1 md:order-2">
        <Map
          routes={mapRoutes}
          selectedId={selected?.id}
          onSelectRoute={setSelectedId}
          user={here ? { point: here, accuracy: geo.fix?.accuracy } : null}
          markers={markers}
          fitKey={`${plan?.departAt ?? ""}-${to?.point.join(",") ?? ""}-${here ? "h" : ""}`}
        />
      </section>
    </main>
  );
}

function WeatherNote({ weather, later }: { weather: NonNullable<PlanResult["weather"]>; later: boolean }) {
  const when = later ? "at your departure time" : "right now";
  const notes: string[] = [];
  if (weather.heavyRain) notes.push(`Heavy rain is forecast ${when}: streets will be emptier and underpasses may flood.`);
  else if (weather.isRaining) notes.push(`Rain is forecast ${when}: streets are likely emptier than usual.`);
  if (weather.foggy) {
    const vis = weather.visibilityM != null ? ` (visibility about ${weather.visibilityM < 1000 ? `${Math.round(weather.visibilityM / 50) * 50} m` : `${(weather.visibilityM / 1000).toFixed(1)} km`})` : "";
    notes.push(`Fog is forecast${vis}: drivers and passers-by see less, so lighting counts for less.`);
  }
  if (!notes.length) return null;
  return (
    <div className="space-y-1 rounded-xl bg-sky-50 p-3 text-sm text-sky-900">
      {notes.map((n) => (
        <p key={n}>{n}</p>
      ))}
    </div>
  );
}
