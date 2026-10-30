"use client";

import { Accessibility, ArrowRight, ArrowUpDown, Car, ChevronRight, Clock, CloudRain, Download, Footprints, Info, LocateFixed, MapPin, MessageSquareWarning, Moon, PhoneCall, Radio, ScanSearch, ShieldCheck, Star, Sun, Sunset, Timer, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Map, { type MapMarker, type MapRoute } from "@/components/Map";
import { PlaceSearch, type PlaceValue } from "@/components/PlaceSearch";
import { RouteCard } from "@/components/RouteCard";
import { initials } from "@/components/Sos";
import { Callout, IconTile, ProgressRing, Segmented, type Tone } from "@/components/ui";
import { api, newShareToken } from "@/lib/client/api";
import { useGeolocation, usePrefs, useSession } from "@/lib/client/hooks";
import { store, type SavedPlace } from "@/lib/client/store";
import type { LngLat } from "@/lib/geo";
import { VEHICLE_LABELS, VEHICLE_TYPES, type VehicleType } from "@/lib/phone";
import type { PlanResult } from "@/lib/safety/plan";
import { useInstall } from "@/lib/client/install";
import { isNativeApp } from "@/lib/client/native";
import { useReadiness } from "@/lib/client/readiness";
import { lightPeriod, type LightPeriod } from "@/lib/time";

type Mode = "walk" | "ride";

function localDateTimeValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const PERIOD_BADGE: Record<LightPeriod, { text: string; icon: typeof Sun; tone: Tone }> = {
  day: { text: "Daylight", icon: Sun, tone: "caution" },
  twilight: { text: "Dusk: lighting matters", icon: Sunset, tone: "caution" },
  night: { text: "Dark: lit, busy streets preferred", icon: Moon, tone: "brand" },
  late_night: { text: "Late night: most shops shut", icon: Moon, tone: "brand" },
};

const TOOLS: { href: string; label: string; text: string; icon: typeof Sun; tone: Tone }[] = [
  { href: "/area", label: "Is it safe here?", text: "Live check of the streets around you", icon: ScanSearch, tone: "good" },
  { href: "/timer", label: "Safety timer", text: "Auto-SOS if you don't check in", icon: Timer, tone: "info" },
  { href: "/fake-call", label: "Fake call", text: "A reason to leave, on demand", icon: PhoneCall, tone: "brand" },
  { href: "/report", label: "Report a spot", text: "Warn others about a place", icon: MessageSquareWarning, tone: "danger" },
];

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? "Stay safe tonight" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 21 ? "Good evening" : "Stay safe tonight";
}

export default function PlanPage() {
  const router = useRouter();
  const { me, contacts } = useSession();
  const readiness = useReadiness();
  const { installed, canPrompt, install } = useInstall();
  const [installHidden, setInstallHidden] = useState(true);
  useEffect(() => {
    try {
      setInstallHidden(isNativeApp() || localStorage.getItem("safenav.installHidden") === "1");
    } catch {
      setInstallHidden(isNativeApp());
    }
  }, []);
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

  // Once per visit, have the server fetch the streets around here, so the first plan is quick.
  const warmed = here != null;
  useEffect(() => {
    if (!warmed || !here) return;
    try {
      if (sessionStorage.getItem("safenav.warmed")) return;
      sessionStorage.setItem("safenav.warmed", "1");
    } catch {
      // fine: warm anyway
    }
    void fetch(`/api/street/prewarm?lng=${here[0].toFixed(3)}&lat=${here[1].toFixed(3)}`, { method: "POST" }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warmed]);

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
        notifyContacts: prefs.notifyOnStart,
        ...(mode === "ride" ? { vehicleType: vehicle.type, vehiclePlate: vehicle.plate || undefined, vehicleNote: vehicle.note || undefined } : {}),
      };
      const { trip, notified } = await api<{ trip: { id: string; expectedArrival: string }; notified?: number }>("/api/trips", { method: "POST", json: body });
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
      router.push(`/journey?new=1&notified=${notified ?? 0}`);
    } catch (err) {
      setError((err as Error).message);
      setStarting(false);
    }
  };

  const badge = period ? PERIOD_BADGE[period] : null;
  const firstName = me?.name.split(" ")[0];

  return (
    <main id="main" className="flex h-dvh flex-col md:flex-row">
      <section className={`relative h-[38dvh] shrink-0 md:order-2 md:h-auto md:flex-1 ${pickFor ? "pick-mode" : ""}`} aria-label="Map">
        <Map
          routes={mapRoutes}
          selectedId={selected?.id}
          onSelectRoute={setSelectedId}
          onMapClick={onMapClick}
          user={here ? { point: here, accuracy: geo.fix?.accuracy } : null}
          markers={markers}
          fitKey={`${plan?.departAt ?? ""}-${to?.point.join(",") ?? ""}-${here ? "h" : ""}`}
        />
        {!pickFor && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:hidden">
            <span className="pointer-events-auto flex items-center gap-2 rounded-full bg-surface/95 py-1.5 pl-1.5 pr-3.5 shadow-card backdrop-blur">
              <span className="hero-gradient flex h-8 w-8 items-center justify-center rounded-full">
                <ShieldCheck className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="text-[15px] font-extrabold tracking-tight text-ink">SafeNav</span>
            </span>
            <AccountButton name={me?.name} />
          </div>
        )}
        {badge && !pickFor && (
          <span className="pointer-events-none absolute bottom-8 left-3 flex items-center gap-1.5 rounded-full bg-surface/95 px-3 py-1.5 text-[13px] font-bold text-ink shadow-card backdrop-blur md:bottom-3">
            <badge.icon className={`h-4 w-4 ${badge.tone === "caution" ? "text-caution" : "text-brand-ink"}`} aria-hidden />
            {badge.text}
          </span>
        )}
        {pickFor && (
          <div className="absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] flex items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-[15px] font-semibold text-canvas shadow-float">
            <MapPin className="h-5 w-5 shrink-0" aria-hidden />
            <span className="flex-1">Tap the map to set your {pickFor === "from" ? "start" : "destination"}</span>
            <button onClick={() => setPickFor(null)} aria-label="Cancel choosing on map" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10">
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
      </section>

      <section className="sheet relative z-10 -mt-6 flex min-h-0 flex-1 flex-col overflow-y-auto bg-canvas pb-nav md:order-1 md:mt-0 md:w-[460px] md:flex-none md:border-r md:border-line">
        <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-line-strong md:hidden" aria-hidden />
        <div className="space-y-4 px-4 pb-3 pt-3 md:pt-[max(1.5rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-2">{greeting()}{firstName ? `, ${firstName}` : ""}</p>
              <h1 className="text-2xl font-extrabold tracking-tight text-ink">Where are you going?</h1>
            </div>
            <span className="hidden md:block">
              <AccountButton name={me?.name} />
            </span>
          </div>

          {activeJourney && (
            <Link href="/journey" className="flex min-h-14 items-center gap-3 rounded-2xl bg-good px-4 font-bold text-white shadow-card dark:text-[#062217]">
              <Radio className="h-5 w-5 animate-pulse" aria-hidden />
              <span className="flex-1">Journey in progress</span>
              <span className="flex items-center gap-1 text-sm">
                Return <ChevronRight className="h-4 w-4" aria-hidden />
              </span>
            </Link>
          )}

          <div className="card space-y-3 p-3.5">
            <Segmented
              label="Travel mode"
              value={mode}
              onChange={(m) => {
                setMode(m);
                resetPlan();
              }}
              options={[
                { value: "walk", label: "Walk", icon: Footprints },
                { value: "ride", label: "Cab / Auto", icon: Car },
              ]}
            />

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
                iconClass="text-good"
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
                iconClass="text-brand-ink"
              />
              <button
                onClick={swap}
                aria-label="Swap start and destination"
                className="absolute right-12 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface text-ink-2 shadow-card ring-1 ring-line hover:text-brand-ink"
              >
                <ArrowUpDown className="h-[18px] w-[18px]" />
              </button>
            </div>

            {favorites.length > 0 && !to && (
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5" aria-label="Saved places">
                {favorites.slice(0, 6).map((f) => (
                  <button
                    key={f.point.join(",")}
                    onClick={() => {
                      setTo({ label: f.label, detail: f.detail, point: f.point });
                      resetPlan();
                    }}
                    className="chip shrink-0"
                  >
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />
                    <span className="max-w-[9rem] truncate">{f.label}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {mode === "walk" && (
                <button
                  onClick={() => {
                    setPrefs({ stepFree: !prefs.stepFree });
                    resetPlan();
                  }}
                  aria-pressed={prefs.stepFree}
                  className="chip"
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
                className="chip"
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
                  className="field min-h-10 min-w-0 flex-1 rounded-full py-2 text-sm"
                  aria-label="Departure time"
                />
              )}
            </div>

            <button onClick={findRoutes} disabled={!from || !to || loading} className="btn btn-primary w-full text-base" aria-busy={loading}>
              {loading ? (
                <>
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
                  {mode === "walk" ? "Checking lights, shops and streets…" : "Finding route…"}
                </>
              ) : (
                <>
                  {mode === "walk" ? "Find safest route" : "Plan ride"}
                  <ArrowRight className="h-5 w-5" aria-hidden />
                </>
              )}
            </button>
            {geo.error && !from && <p className="text-sm text-caution">{geo.error}</p>}
          </div>
        </div>

        <div className="space-y-3 px-4 pb-4">
          {error && (
            <Callout tone="danger" icon={TriangleAlert}>
              {error}
            </Callout>
          )}
          {plan?.advice && (
            <Callout tone="danger" icon={TriangleAlert}>
              {plan.advice}
            </Callout>
          )}
          {plan?.dataNote && (
            <Callout tone="caution" icon={Info}>
              {plan.dataNote}
            </Callout>
          )}
          {plan?.weather && <WeatherNote weather={plan.weather} later={leaveLater} />}
          {plan?.stepFree && (
            <Callout tone="brand" icon={Accessibility}>
              Step-free: routes with steps, unpaved or rough surfaces are ranked last. OpenStreetMap may not map every kerb or ramp.
            </Callout>
          )}

          {plan && plan.routes.length > 0 && (
            <p className="eyebrow px-1 pt-1">
              {plan.routes.length} route{plan.routes.length > 1 ? "s" : ""} · safest first
              {plan.searched?.safetySearch ? ` · ${plan.searched.streetsScored.toLocaleString("en-IN")} streets checked for a safer way` : ""}
            </p>
          )}
          {plan?.routes.map((r) => (
            <RouteCard key={r.id} route={r} selected={r.id === selected?.id} onSelect={() => setSelectedId(r.id)} mode={plan.mode} stepFree={plan.stepFree} />
          ))}

          {plan && selected && (
            <div className="card space-y-3 p-4">
              {plan.mode === "ride" && (
                <fieldset className="space-y-2.5">
                  <legend className="label">Vehicle details, shared with your contacts</legend>
                  <select value={vehicle.type} onChange={(e) => setVehicle((v) => ({ ...v, type: e.target.value as VehicleType }))} className="field" aria-label="Vehicle type">
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
                    className="field uppercase"
                    aria-label="Number plate"
                    autoCapitalize="characters"
                  />
                  <input
                    value={vehicle.note}
                    onChange={(e) => setVehicle((v) => ({ ...v, note: e.target.value }))}
                    placeholder="Driver name or booking ID (optional)"
                    className="field"
                    aria-label="Driver or booking details"
                    maxLength={120}
                  />
                </fieldset>
              )}
              <button onClick={startJourney} disabled={starting} className="btn btn-good w-full text-base">
                <Radio className="h-5 w-5" aria-hidden />
                {starting ? "Starting…" : me ? (plan.mode === "ride" ? "Start ride monitoring" : "Start journey and share live") : "Sign in to start a monitored journey"}
              </button>
              <p className="text-sm text-ink-2">
                {contacts.length
                  ? `${contacts.length === 1 ? contacts[0].name.split(" ")[0] : `Your ${contacts.length} contacts`} can follow you live. `
                  : "Your contacts get a live link. "}
                SafeNav checks in if you stop, leave the route or run late, and sends SOS if you don&apos;t answer.
              </p>
            </div>
          )}

          {!plan && !loading && (
            <>
              {!readiness.ready && readiness.next && (
                <Link href={readiness.next.href} className="hero-gradient rise flex items-center gap-4 rounded-3xl p-4 shadow-card">
                  <ProgressRing done={readiness.done} total={readiness.items.length} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-white/80">Finish your safety setup</span>
                    <span className="block text-lg font-extrabold leading-snug">{readiness.next.title}</span>
                    <span className="block text-sm text-white/85">{readiness.next.text}</span>
                  </span>
                  <ChevronRight className="h-6 w-6 shrink-0" aria-hidden />
                </Link>
              )}

              {canPrompt && !installed && !installHidden && (
                <div className="card rise flex items-center gap-3 p-4">
                  <IconTile icon={Download} tone="brand" />
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold text-ink">Install SafeNav</p>
                    <p className="text-[13px] text-ink-2">Opens from your home screen, no download needed.</p>
                  </div>
                  <button onClick={() => void install()} className="btn btn-primary btn-sm shrink-0">
                    Install
                  </button>
                  <button
                    onClick={() => {
                      setInstallHidden(true);
                      try {
                        localStorage.setItem("safenav.installHidden", "1");
                      } catch {
                        // not critical
                      }
                    }}
                    aria-label="Hide"
                    className="tap -mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-3"
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {TOOLS.map((t, i) => (
                  <Link key={t.href} href={t.href} className={`card tap rise rise-${i + 1} flex min-h-[8.5rem] flex-col gap-3 p-4`}>
                    <IconTile icon={t.icon} tone={t.tone} />
                    <span>
                      <span className="block font-extrabold leading-snug text-ink">{t.label}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-ink-2">{t.text}</span>
                    </span>
                  </Link>
                ))}
              </div>

              <Link href="/about" className="card tap flex items-center gap-3 p-4">
                <IconTile icon={Info} tone="neutral" />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-ink">How routes are scored</span>
                  <span className="block text-[13px] leading-snug text-ink-2">Street lights, footpaths, open shops, homes facing the street, police nearby, weather and reports, every 100 m.</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-ink-3" aria-hidden />
              </Link>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function AccountButton({ name }: { name?: string }) {
  return (
    <Link
      href={name ? "/account" : "/login"}
      aria-label={name ? `Your account, ${name}` : "Sign in"}
      className="pointer-events-auto flex h-11 min-w-11 items-center justify-center rounded-full bg-surface/95 px-1.5 shadow-card ring-1 ring-line backdrop-blur"
    >
      {name ? (
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-sm font-extrabold text-brand-soft-ink">{initials(name)}</span>
      ) : (
        <span className="px-2.5 text-sm font-bold text-brand-ink">Sign in</span>
      )}
    </Link>
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
    <Callout tone="info" icon={CloudRain}>
      {notes.map((n) => (
        <p key={n}>{n}</p>
      ))}
    </Callout>
  );
}
