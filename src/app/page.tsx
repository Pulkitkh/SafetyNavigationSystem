"use client";

import { Accessibility, ArrowUpDown, Car, Clock, Footprints, LocateFixed, MapPin, MessageSquareWarning, Moon, PhoneCall, ScanSearch, ShieldCheck, Star, Sun, Sunset, Timer, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Map, { type MapMarker, type MapRoute } from "@/components/Map";
import { PlaceSearch, type PlaceValue } from "@/components/PlaceSearch";
import { RouteCard } from "@/components/RouteCard";
import { api, newShareToken } from "@/lib/client/api";
import { useGeolocation, usePrefs, useSession } from "@/lib/client/hooks";
import { store, type SavedPlace } from "@/lib/client/store";
import type { LngLat } from "@/lib/geo";
import { VEHICLE_LABELS, VEHICLE_TYPES, type VehicleType } from "@/lib/phone";
import type { PlanResult } from "@/lib/safety/plan";
import { lightPeriod, type LightPeriod } from "@/lib/time";

type Mode = "walk" | "ride";

function localDateTimeValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const PERIOD_BADGE: Record<LightPeriod, { text: string; icon: typeof Sun; cls: string }> = {
  day: { text: "Daylight now", icon: Sun, cls: "bg-amber-50 text-amber-800" },
  twilight: { text: "Dusk: lighting starts to matter", icon: Sunset, cls: "bg-orange-50 text-orange-800" },
  night: { text: "Dark now: lit, busy streets are preferred", icon: Moon, cls: "bg-indigo-50 text-indigo-800" },
  late_night: { text: "Late night: most shops are shut", icon: Moon, cls: "bg-slate-900 text-slate-100" },
};

const TOOLS = [
  { href: "/area", label: "Is it safe here?", text: "Live check of your area", icon: ScanSearch, cls: "bg-emerald-50 text-emerald-700" },
  { href: "/timer", label: "Safety timer", text: "Auto-SOS if you don't check in", icon: Timer, cls: "bg-sky-50 text-sky-700" },
  { href: "/fake-call", label: "Fake call", text: "Exit an awkward situation", icon: PhoneCall, cls: "bg-violet-50 text-violet-700" },
  { href: "/report", label: "Report a spot", text: "Warn others about a place", icon: MessageSquareWarning, cls: "bg-rose-50 text-rose-700" },
];

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
  const [pickFor, setPickFor] = useState<"from" | "to" | null>(null);
  const [favorites, setFavorites] = useState<SavedPlace[]>([]);
  const [period, setPeriod] = useState<LightPeriod | null>(null);

  useEffect(() => setActiveJourney(!!store.journey()), []);
  useEffect(() => {
    const sync = () => setFavorites(store.places().favorites);
    sync();
    window.addEventListener("safenav:places", sync);
    return () => window.removeEventListener("safenav:places", sync);
  }, []);

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
    if (here) setPeriod(lightPeriod(new Date(), here[1], here[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here?.[0], here?.[1]]);

  const resetPlan = () => setPlan(null);

  const findRoutes = async () => {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    setPlan(null);
    try {
      const startPoint = from.current && here ? here : from.point;
      const departAt = leaveLater ? new Date(departLocal).toISOString() : undefined;
      const result = await api<PlanResult>("/api/routes/plan", {
        method: "POST",
        json: { from: startPoint, to: to.point, mode, departAt, stepFree: mode === "walk" && prefs.stepFree },
      });
      setPlan(result);
      setSelectedId(result.routes[0]?.id ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  /** Tap on the map while choosing a point: name it by reverse geocoding. */
  const onMapClick = async (p: LngLat) => {
    if (!pickFor) return;
    const target = pickFor;
    setPickFor(null);
    const set = target === "from" ? setFrom : setTo;
    set({ label: "Dropped pin", detail: `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`, point: p });
    resetPlan();
    try {
      const { place } = await api<{ place: { label: string; detail: string } }>(`/api/geocode/reverse?lng=${p[0]}&lat=${p[1]}`);
      set({ label: place.label, detail: place.detail, point: p });
      store.addRecent({ label: place.label, detail: place.detail, point: p });
    } catch {
      // keep the coordinate label
    }
  };

  const swap = () => {
    if (!from && !to) return;
    const f = from;
    setFrom(to);
    setTo(f?.current ? { ...f, label: "Your current location" } : f);
    resetPlan();
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

  const badge = period ? PERIOD_BADGE[period] : null;

  return (
    <main className="flex h-dvh flex-col md:flex-row">
      <section className={`relative h-[42dvh] shrink-0 md:order-2 md:h-auto md:flex-1 ${pickFor ? "pick-mode" : ""}`}>
        <Map
          routes={mapRoutes}
          selectedId={selected?.id}
          onSelectRoute={setSelectedId}
          onMapClick={onMapClick}
          user={here ? { point: here, accuracy: geo.fix?.accuracy } : null}
          markers={markers}
          fitKey={`${plan?.departAt ?? ""}-${to?.point.join(",") ?? ""}-${here ? "h" : ""}`}
        />
        {pickFor && (
          <div className="absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] flex items-center gap-3 rounded-2xl bg-slate-900/90 px-4 py-3 text-sm text-white shadow-lg">
            <MapPin className="h-5 w-5 shrink-0 text-brand-300" aria-hidden />
            <span className="flex-1">Tap the map to set your {pickFor === "from" ? "start" : "destination"}</span>
            <button onClick={() => setPickFor(null)} aria-label="Cancel choosing on map" className="rounded-full p-1 hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </section>

      <section className="sheet relative z-10 -mt-6 flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#f6f5fb] pb-nav md:order-1 md:mt-0 md:w-[440px] md:flex-none md:border-r md:border-slate-200">
        <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-slate-300 md:hidden" aria-hidden />
        <div className="space-y-3 px-4 pb-3 pt-3 md:pt-[max(1.25rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-md shadow-brand-500/30">
                <ShieldCheck className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h1 className="text-lg font-bold leading-tight tracking-tight text-slate-900">SafeNav</h1>
                <p className="text-xs text-slate-500">Safest routes, live sharing, SOS</p>
              </div>
            </div>
            <Link href={me ? "/account" : "/login"} className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-brand-700 shadow-sm ring-1 ring-slate-200">
              {me ? me.name.split(" ")[0] : "Sign in"}
            </Link>
          </div>

          {activeJourney && (
            <Link href="/journey" className="flex items-center gap-2 rounded-2xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden />
              Journey in progress — tap to return
            </Link>
          )}

          <div className="card space-y-3 p-3">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-semibold" role="tablist" aria-label="Travel mode">
              {(["walk", "ride"] as const).map((m) => {
                const Icon = m === "walk" ? Footprints : Car;
                return (
                  <button
                    key={m}
                    role="tab"
                    aria-selected={mode === m}
                    onClick={() => {
                      setMode(m);
                      resetPlan();
                    }}
                    className={`flex items-center justify-center gap-2 rounded-lg py-2 transition ${mode === m ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {m === "walk" ? "Walk" : "Cab / Auto"}
                  </button>
                );
              })}
            </div>

            <div className="relative space-y-2">
              <PlaceSearch
                label="Start"
                placeholder="Start: search, paste a link or plus code"
                value={from}
                onChange={(v) => {
                  setFrom(v);
                  resetPlan();
                }}
                near={here}
                allowCurrent
                currentPoint={here}
                onPickOnMap={() => setPickFor("from")}
                icon={LocateFixed}
                iconClass="text-emerald-600"
              />
              <PlaceSearch
                label="Destination"
                placeholder="Where to?"
                value={to}
                onChange={(v) => {
                  setTo(v);
                  resetPlan();
                }}
                near={here ?? from?.point}
                onPickOnMap={() => setPickFor("to")}
                icon={MapPin}
                iconClass="text-brand-600"
              />
              <button
                onClick={swap}
                aria-label="Swap start and destination"
                className="absolute right-11 top-1/2 z-10 -translate-y-1/2 rounded-full border border-slate-200 bg-white p-1.5 text-slate-500 shadow-sm hover:text-brand-700"
              >
                <ArrowUpDown className="h-4 w-4" />
              </button>
            </div>

            {favorites.length > 0 && !to && (
              <div className="flex gap-2 overflow-x-auto pb-0.5" aria-label="Saved places">
                {favorites.slice(0, 6).map((f) => (
                  <button
                    key={f.point.join(",")}
                    onClick={() => {
                      setTo({ label: f.label, detail: f.detail, point: f.point });
                      resetPlan();
                    }}
                    className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200"
                  >
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                    <span className="max-w-[9rem] truncate">{f.label}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 text-sm">
              {mode === "walk" && (
                <button
                  onClick={() => {
                    setPrefs({ stepFree: !prefs.stepFree });
                    resetPlan();
                  }}
                  aria-pressed={prefs.stepFree}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium ring-1 transition ${prefs.stepFree ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-200"}`}
                >
                  <Accessibility className="h-4 w-4" aria-hidden />
                  Step-free
                </button>
              )}
              <button
                onClick={() => {
                  setLeaveLater((v) => !v);
                  resetPlan();
                }}
                aria-pressed={leaveLater}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium ring-1 transition ${leaveLater ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-200"}`}
              >
                <Clock className="h-4 w-4" aria-hidden />
                Leave later
              </button>
              {leaveLater && (
                <input
                  type="datetime-local"
                  value={departLocal}
                  onChange={(e) => {
                    setDepartLocal(e.target.value);
                    resetPlan();
                  }}
                  className="min-w-0 flex-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm"
                  aria-label="Departure time"
                />
              )}
            </div>

            <button
              onClick={findRoutes}
              disabled={!from || !to || loading}
              className="brand-gradient w-full rounded-xl py-3 font-semibold text-white shadow-md shadow-brand-500/30 transition active:scale-[0.99] disabled:opacity-50 disabled:shadow-none"
            >
              {loading ? (mode === "walk" ? "Checking lights, shops and streets…" : "Finding route…") : mode === "walk" ? "Find safest route" : "Plan ride"}
            </button>
            {geo.error && !from && <p className="text-xs text-amber-800">{geo.error}</p>}
          </div>

          {badge && !plan && (
            <p className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${badge.cls}`}>
              <badge.icon className="h-4 w-4" aria-hidden />
              {badge.text}
            </p>
          )}
        </div>

        <div className="space-y-3 px-4 pb-4">
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-100">{error}</p>}
          {plan?.dataNote && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-100">{plan.dataNote}</p>}
          {plan?.weather && <WeatherNote weather={plan.weather} later={leaveLater} />}
          {plan?.stepFree && (
            <p className="rounded-xl bg-violet-50 p-3 text-sm text-violet-900 ring-1 ring-violet-100">
              Step-free: routes with steps, unpaved or rough surfaces are ranked last. OpenStreetMap may not map every kerb or ramp.
            </p>
          )}

          {plan?.routes.map((r) => (
            <RouteCard key={r.id} route={r} selected={r.id === selected?.id} onSelect={() => setSelectedId(r.id)} mode={plan.mode} stepFree={plan.stepFree} />
          ))}

          {plan && selected && (
            <div className="card space-y-3 p-4">
              {plan.mode === "ride" && (
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-semibold text-slate-800">Vehicle details (shared with your contacts)</legend>
                  <select
                    value={vehicle.type}
                    onChange={(e) => setVehicle((v) => ({ ...v, type: e.target.value as VehicleType }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm"
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
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm uppercase"
                    aria-label="Number plate"
                    autoCapitalize="characters"
                  />
                  <input
                    value={vehicle.note}
                    onChange={(e) => setVehicle((v) => ({ ...v, note: e.target.value }))}
                    placeholder="Driver name / app booking ID (optional)"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm"
                    aria-label="Driver or booking details"
                    maxLength={120}
                  />
                </fieldset>
              )}
              <button onClick={startJourney} disabled={starting} className="w-full rounded-xl bg-green-600 py-3 font-semibold text-white shadow-md shadow-green-600/25 disabled:opacity-50">
                {starting ? "Starting…" : me ? (plan.mode === "ride" ? "Start ride monitoring" : "Start journey & share live") : "Sign in to start a monitored journey"}
              </button>
              <p className="text-xs text-slate-500">
                Your contacts get a live link. SafeNav checks in if you stop, leave the route or are late, and sends SOS if you don&apos;t answer.
              </p>
            </div>
          )}

          {!plan && !loading && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {TOOLS.map((t) => (
                  <Link key={t.href} href={t.href} className="card flex flex-col gap-2 p-3 transition hover:-translate-y-0.5">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${t.cls}`}>
                      <t.icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">{t.label}</span>
                      <span className="block text-xs text-slate-500">{t.text}</span>
                    </span>
                  </Link>
                ))}
              </div>
              <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                <p className="font-semibold text-slate-800">How routes are scored</p>
                <p className="mt-1">
                  Every 100 m is rated from live OpenStreetMap data: street lights, footpaths, shops open at that hour, homes facing the street, isolated
                  land, police and hospitals nearby, the weather forecast and reports from other users.{" "}
                  <Link href="/about" className="font-medium text-brand-700 underline">
                    Learn more
                  </Link>
                </p>
              </div>
            </>
          )}
        </div>
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
    const vis =
      weather.visibilityM != null
        ? ` (visibility about ${weather.visibilityM < 1000 ? `${Math.round(weather.visibilityM / 50) * 50} m` : `${(weather.visibilityM / 1000).toFixed(1)} km`})`
        : "";
    notes.push(`Fog is forecast${vis}: drivers and passers-by see less, so lighting counts for less.`);
  }
  if (!notes.length) return null;
  return (
    <div className="space-y-1 rounded-xl bg-sky-50 p-3 text-sm text-sky-900 ring-1 ring-sky-100">
      {notes.map((n) => (
        <p key={n}>{n}</p>
      ))}
    </div>
  );
}
