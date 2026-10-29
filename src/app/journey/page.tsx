"use client";

import { BellRing, Check, CircleAlert, Eye, MapPin, Navigation, PhoneCall, Radio, Route, Share2, Volume2, VolumeX, WifiOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { type MapMarker } from "@/components/Map";
import { useSos } from "@/components/Sos";
import { Callout, EmptyState } from "@/components/ui";
import { api, formatDistance } from "@/lib/client/api";
import { batteryLevel, useGeolocation, usePrefs, useSession, useWakeLock } from "@/lib/client/hooks";
import { isNativeApp } from "@/lib/client/native";
import { speak, useVoiceGuidance, voiceSupported } from "@/lib/client/voice";
import { store, type ActiveJourney } from "@/lib/client/store";
import { distanceToPolyline, type LngLat } from "@/lib/geo";
import { ANOMALY_TEXT, CHECKIN_TIMEOUT_S, evaluate, initialMonitorState, MONITOR_CONFIG, snooze, type Anomaly, type Fix } from "@/lib/monitor";
import type { PlanResult } from "@/lib/safety/plan";
import { detectPlatform, journeyMessage, smsUri, whatsappUri } from "@/lib/sos";

const PUSH_EVERY_MS = 10_000;

export default function JourneyPage() {
  const router = useRouter();
  const { me, contacts } = useSession();
  const sos = useSos();
  const [journey, setJourney] = useState<ActiveJourney | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [remote, setRemote] = useState<{ id: string; destLabel: string } | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [notified, setNotified] = useState(0);
  const geo = useGeolocation(!!journey, true);
  useWakeLock(!!journey);

  useEffect(() => {
    const j = store.journey();
    setJourney(j);
    const q = new URLSearchParams(window.location.search);
    setIsNew(q.get("new") === "1");
    setNotified(Number(q.get("notified")) || 0);
    if (!j) {
      api<{ trip: { id: string; destLabel: string } | null }>("/api/trips")
        .then(({ trip }) => setRemote(trip))
        .catch(() => {})
        .finally(() => setLoaded(true));
    } else setLoaded(true);
  }, []);

  if (!loaded) return <main id="main" className="flex min-h-dvh items-center justify-center text-ink-2">Loading…</main>;
  if (!journey) {
    return (
      <main id="main" className="pt-safe mx-auto max-w-lg px-4 pb-nav">
        <div className="card mt-4">
          {remote ? (
            <EmptyState
              icon={Radio}
              title="Journey shared from another device"
              text={`A journey to ${remote.destLabel} is still being shared.`}
              action={
                <button
                  onClick={async () => {
                    await api(`/api/trips/${remote.id}`, { method: "PATCH", json: { status: "ended", reason: "Ended from another device" } }).catch(() => {});
                    setRemote(null);
                  }}
                  className="btn btn-outline w-full"
                >
                  End that journey
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={Route}
              title="No journey in progress"
              text="Plan a route and tap Start journey. Your contacts follow you live, and SafeNav checks on you along the way."
              action={
                <Link href="/" className="btn btn-primary w-full">
                  Plan a route
                </Link>
              }
            />
          )}
        </div>
      </main>
    );
  }

  return (
    <ActiveJourneyView
      journey={journey}
      geo={geo}
      contacts={contacts}
      userName={me?.name ?? "I"}
      autoSos={me?.autoSos ?? true}
      sosActive={sos.active}
      onSos={sos.trigger}
      isNew={isNew}
      notified={notified}
      onRerouted={(j) => {
        store.setJourney(j);
        setJourney(j);
      }}
      onEnded={() => {
        store.setJourney(null);
        router.push("/");
      }}
    />
  );
}

function ActiveJourneyView({
  journey,
  geo,
  contacts,
  userName,
  autoSos,
  sosActive,
  onSos,
  isNew,
  notified,
  onRerouted,
  onEnded,
}: {
  journey: ActiveJourney;
  geo: ReturnType<typeof useGeolocation>;
  contacts: { name: string; phone: string }[];
  userName: string;
  autoSos: boolean;
  sosActive: boolean;
  onSos: (t?: "manual" | "missed_checkin" | "deviation") => void;
  isNew: boolean;
  notified: number;
  onRerouted: (j: ActiveJourney) => void;
  onEnded: () => void;
}) {
  const cfg = MONITOR_CONFIG[journey.mode];
  const monitorRef = useRef(initialMonitorState());
  const [checkin, setCheckin] = useState<{ anomaly: Anomaly; deadline: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [arrived, setArrived] = useState(false);
  const [remainingM, setRemainingM] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const [offRouteM, setOffRouteM] = useState(0);
  const [rerouting, setRerouting] = useState(false);
  const [rerouteError, setRerouteError] = useState<string | null>(null);
  const [prefs, setPrefs] = usePrefs();
  const [canSpeak, setCanSpeak] = useState(false);
  const [nativeApp, setNativeApp] = useState(false);
  const lastPush = useRef(0);
  const arrivalSnoozedUntil = useRef(0);
  const liveUrl = typeof window !== "undefined" ? `${window.location.origin}/t/${journey.shareToken}` : "";
  const shareText = journeyMessage(userName, journey.destLabel, liveUrl, new Date(journey.expectedArrival), journey.vehicle);

  useEffect(() => {
    setPlatform(detectPlatform(navigator.userAgent));
    setCanSpeak(voiceSupported());
    setNativeApp(isNativeApp());
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const setStatus = useCallback(
    (status: "active" | "alert" | "ended", reason?: string) =>
      api(`/api/trips/${journey.tripId}`, { method: "PATCH", json: { status, reason } }).catch(() => {}),
    [journey.tripId],
  );

  // Push location to the server for the live link.
  useEffect(() => {
    const f = geo.fix;
    if (!f || Date.now() - lastPush.current < PUSH_EVERY_MS) return;
    lastPush.current = Date.now();
    (async () => {
      try {
        await api(`/api/trips/${journey.tripId}/location`, {
          method: "POST",
          json: { lat: f.lat, lng: f.lng, accuracy: Math.min(f.accuracy, 10_000), battery: await batteryLevel(), at: f.at },
        });
        setOffline(false);
      } catch (err) {
        setOffline(true);
        if ((err as { status?: number }).status === 409) onEnded(); // ended elsewhere
      }
    })();
  }, [geo.fix, journey.tripId, onEnded]);

  // Evaluate monitoring rules on every fix and once a second (for the overdue timer).
  useEffect(() => {
    if (arrived || sosActive) return;
    const fixes: Fix[] = geo.history.map((f) => ({ point: [f.lng, f.lat], accuracy: f.accuracy, at: f.at }));
    const r = evaluate(fixes, journey.route, journey.dest, journey.expectedArrival, cfg, monitorRef.current, now);
    monitorRef.current = r.state;
    if (fixes.length) {
      setRemainingM(r.remainingM);
      setOffRouteM(r.distanceToRouteM);
    }
    if (r.arrived && now > arrivalSnoozedUntil.current) {
      setArrived(true);
      setCheckin(null);
      return;
    }
    if (r.anomaly && !checkin) {
      setCheckin({ anomaly: r.anomaly, deadline: Date.now() + CHECKIN_TIMEOUT_S * 1000 });
      void setStatus("alert", ANOMALY_TEXT[r.anomaly]);
      if (navigator.vibrate) navigator.vibrate([400, 200, 400]);
      if (prefs.voice) speak(`Are you OK? ${ANOMALY_TEXT[r.anomaly]} Tap I'm OK, or SOS will be sent.`, true);
    }
  }, [geo.history, now, arrived, sosActive, checkin, journey, cfg, setStatus, prefs.voice]);

  // Escalate an unanswered check-in.
  useEffect(() => {
    if (!checkin || now < checkin.deadline) return;
    const anomaly = checkin.anomaly;
    setCheckin(null);
    if (autoSos) onSos(anomaly === "off_route" ? "deviation" : "missed_checkin");
  }, [checkin, now, autoSos, onSos]);

  const answerOk = () => {
    if (!checkin) return;
    monitorRef.current = snooze(monitorRef.current, checkin.anomaly);
    setCheckin(null);
    void setStatus("active");
  };

  /** Plan a fresh, safety-scored route from where the user is now and switch to it. */
  const reroute = async () => {
    const f = geo.fix;
    if (!f || rerouting) return;
    setRerouting(true);
    setRerouteError(null);
    try {
      const plan = await api<PlanResult>("/api/routes/plan", {
        method: "POST",
        json: { from: [f.lng, f.lat], to: journey.dest, mode: journey.mode, stepFree: journey.mode === "walk" && prefs.stepFree },
      });
      const best = plan.routes[0];
      if (!best) throw new Error("No route found from here");
      const { trip } = await api<{ trip: { expectedArrival: string } }>(`/api/trips/${journey.tripId}/reroute`, {
        method: "POST",
        json: { route: best.coordinates, durationS: best.duration },
      });
      monitorRef.current = initialMonitorState();
      onRerouted({
        ...journey,
        route: best.coordinates,
        steps: best.steps.map((s) => ({ instruction: s.instruction, distance: s.distance, location: s.location })),
        expectedArrival: new Date(trip.expectedArrival).getTime(),
      });
      setCheckin(null);
      void setStatus("active");
      if (prefs.voice) speak(`New route. ${best.safety ? `Safety score ${best.safety.score}.` : ""}`, true);
    } catch (err) {
      setRerouteError((err as Error).message);
    } finally {
      setRerouting(false);
    }
  };

  const end = async (reason: string) => {
    await setStatus("ended", reason);
    onEnded();
  };

  const fix = geo.fix;
  const here: LngLat | null = useMemo(() => (fix ? [fix.lng, fix.lat] : null), [fix]);
  const nextStep = useMemo(() => {
    if (!here || !journey.steps.length) return journey.steps[0] ?? null;
    const along = distanceToPolyline(here, journey.route).along;
    return (
      journey.steps.find((s) => distanceToPolyline(s.location, journey.route).along > along + 10) ?? journey.steps[journey.steps.length - 1]
    );
  }, [here, journey]);
  const nextStepDist = nextStep && here ? Math.max(0, distanceToPolyline(nextStep.location, journey.route).along - distanceToPolyline(here, journey.route).along) : null;
  useVoiceGuidance(prefs.voice && !arrived && !checkin && !sosActive, nextStep, nextStepDist);
  const offRoute = journey.mode === "walk" && offRouteM > cfg.offRouteM;

  const markers: MapMarker[] = [{ id: "dest", point: journey.dest, kind: "dest", label: journey.destLabel }];
  const late = now > journey.expectedArrival;
  const eta = new Date(journey.expectedArrival).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const share = async () => {
    try {
      await navigator.share({ title: "Follow my journey", text: shareText });
    } catch {
      await navigator.clipboard?.writeText(shareText).catch(() => {});
    }
  };

  const secondsLeft = checkin ? Math.max(0, Math.ceil((checkin.deadline - now) / 1000)) : 0;
  const C = 2 * Math.PI * 44;

  return (
    <main id="main" className="flex h-dvh flex-col md:flex-row">
      <section className="relative min-h-[45dvh] flex-1 md:order-2" aria-label="Map">
        <Map
          routes={[{ id: "route", coordinates: journey.route }]}
          selectedId="route"
          user={here ? { point: here, accuracy: geo.fix?.accuracy } : null}
          markers={markers}
          fitKey={journey.tripId}
          followUser
        />
        {nextStep && !arrived && (
          <div className="absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] flex items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-canvas shadow-float" aria-live="polite">
            <Navigation className="h-6 w-6 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="text-[17px] font-extrabold leading-snug">{nextStep.instruction}</p>
              {nextStepDist != null && <p className="text-sm opacity-80">in {formatDistance(nextStepDist)}</p>}
            </div>
          </div>
        )}
      </section>

      <section className="sheet relative z-10 -mt-6 max-h-[58dvh] space-y-3 overflow-y-auto bg-canvas p-4 pb-nav md:order-1 md:mt-0 md:max-h-none md:w-[420px]">
        <div className="mx-auto -mt-1.5 h-1.5 w-10 rounded-full bg-line-strong md:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13px] font-extrabold uppercase tracking-wider text-good">
              <span className="relative flex h-2.5 w-2.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-good" />
              </span>
              {journey.mode === "ride" ? "Ride monitoring on" : "Shared live"}
            </p>
            <h1 className="mt-0.5 text-xl font-extrabold leading-tight text-ink">To {journey.destLabel}</h1>
            {journey.vehicle && <p className="text-sm font-semibold text-ink-2">{journey.vehicle}</p>}
          </div>
          <div className="shrink-0 text-right">
            <p className={`text-lg font-extrabold ${late ? "text-caution" : "text-ink"}`}>{eta}</p>
            <p className="text-[13px] text-ink-2">{remainingM != null ? `${formatDistance(remainingM)} left` : "ETA"}</p>
          </div>
        </div>

        {isNew && notified > 0 && (
          <Callout tone="good" icon={BellRing}>
            {notified === 1 ? "1 contact was" : `${notified} contacts were`} notified automatically with your live link.
          </Callout>
        )}
        {geo.error && <Callout tone="caution" icon={CircleAlert}>{geo.error}</Callout>}
        {offRoute && (
          <div className="rounded-2xl bg-caution-soft p-3.5 text-sm text-ink">
            <p className="flex items-center gap-2 font-bold">
              <MapPin className="h-4 w-4 text-caution" aria-hidden />
              You&apos;re {formatDistance(offRouteM)} from the planned route
            </p>
            <button onClick={reroute} disabled={rerouting} className="btn btn-primary mt-2.5 w-full">
              {rerouting ? "Finding the safest way from here…" : "Find a safe route from here"}
            </button>
          </div>
        )}
        {rerouteError && <Callout tone="danger">{rerouteError}</Callout>}
        {offline && (
          <Callout tone="caution" icon={WifiOff}>
            No connection. Your contacts see your last known position. SOS by SMS still works.
          </Callout>
        )}

        {(isNew || contacts.length === 0) && (
          <div className="card p-4">
            <p className="font-extrabold text-ink">{contacts.length === 0 ? "Share your live link" : notified > 0 ? "Send it to anyone else" : "Send the live link to your contacts"}</p>
            {contacts.length === 0 && (
              <p className="mt-1 text-sm text-ink-2">
                You have no trusted contacts yet.{" "}
                <Link href="/contacts" className="font-bold text-brand-ink underline">
                  Add them
                </Link>{" "}
                or share the link yourself.
              </p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              {contacts.length > 0 && (
                <a href={smsUri(contacts.map((c) => c.phone), shareText, platform)} className="btn btn-secondary btn-sm">
                  SMS contacts
                </a>
              )}
              {contacts[0] && (
                <a href={whatsappUri(contacts[0].phone, shareText)} target="_blank" rel="noopener noreferrer" className="btn btn-sm bg-[#128c4b] text-white">
                  WhatsApp {contacts[0].name.split(" ")[0]}
                </a>
              )}
              <button onClick={share} className="btn btn-outline btn-sm col-span-2">
                <Share2 className="h-4 w-4" aria-hidden />
                Share link…
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {!isNew && contacts.length > 0 && (
            <button onClick={share} className="btn btn-outline btn-sm flex-col gap-1 py-2.5 text-[13px]">
              <Share2 className="h-5 w-5" aria-hidden />
              Share link
            </button>
          )}
          {canSpeak && (
            <button onClick={() => setPrefs({ voice: !prefs.voice })} aria-pressed={prefs.voice} className="btn btn-outline btn-sm flex-col gap-1 py-2.5 text-[13px]">
              {prefs.voice ? <Volume2 className="h-5 w-5" aria-hidden /> : <VolumeX className="h-5 w-5" aria-hidden />}
              Voice {prefs.voice ? "on" : "off"}
            </button>
          )}
          <Link href="/fake-call" className="btn btn-outline btn-sm flex-col gap-1 py-2.5 text-[13px]">
            <PhoneCall className="h-5 w-5" aria-hidden />
            Fake call
          </Link>
        </div>

        <div className="card p-4 text-sm text-ink-2">
          <p className="flex items-center gap-2 font-bold text-ink">
            <Eye className="h-4 w-4 text-brand-ink" aria-hidden />
            SafeNav is watching for
          </p>
          <ul className="mt-2 space-y-1.5">
            <li className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-hidden />
              Leaving the route by more than {cfg.offRouteM} m
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-hidden />
              No movement for {Math.round(cfg.stoppedForMs / 60_000)} minutes
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-hidden />
              Arriving more than {Math.round(cfg.overdueGraceMs / 60_000)} minutes late
            </li>
          </ul>
          <p className="mt-2.5 text-[13px]">
            {nativeApp
              ? "Tracking continues with the screen locked while the SafeNav notification is showing."
              : "Keep this screen open: browsers pause location in the background. The SafeNav app keeps tracking with the screen locked."}
          </p>
        </div>

        {confirmEnd ? (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => end("Ended by user")} className="btn btn-primary">
              End journey
            </button>
            <button onClick={() => setConfirmEnd(false)} className="btn btn-outline">
              Keep going
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmEnd(true)} className="btn btn-outline w-full">
            I&apos;ve arrived, end journey
          </button>
        )}
      </section>

      {checkin && !sosActive && (
        <div className="fixed inset-0 z-[95] flex items-end justify-center p-4 sm:items-center" style={{ background: "var(--scrim)" }} role="alertdialog" aria-modal="true" aria-labelledby="checkin-title">
          <div className="sheet-in w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-float">
            <h2 id="checkin-title" className="text-2xl font-extrabold text-ink">
              Are you OK?
            </h2>
            <p className="mt-1 text-ink-2">{ANOMALY_TEXT[checkin.anomaly]}</p>
            <div className="relative mx-auto my-4 h-28 w-28">
              <svg viewBox="0 0 100 100" className="-rotate-90" aria-hidden>
                <circle cx="50" cy="50" r="44" fill="none" stroke="var(--surface-3)" strokeWidth="8" />
                <circle cx="50" cy="50" r="44" fill="none" stroke="var(--sos)" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(secondsLeft / CHECKIN_TIMEOUT_S) * C} ${C}`} style={{ transition: "stroke-dasharray 1s linear" }} />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-4xl font-extrabold tabular-nums text-ink" aria-live="polite">
                {secondsLeft}
              </span>
            </div>
            <p className="text-[13px] text-ink-3">{autoSos ? "SOS is sent automatically when the timer ends" : "Automatic SOS is off in your account settings"}</p>
            <div className="mt-5 grid gap-2">
              <button onClick={answerOk} className="btn btn-good text-lg">
                <Check className="h-5 w-5" strokeWidth={3} aria-hidden />
                I&apos;m OK
              </button>
              {checkin.anomaly === "off_route" && journey.mode === "walk" && (
                <button
                  onClick={() => {
                    answerOk();
                    void reroute();
                  }}
                  className="btn btn-outline"
                >
                  I&apos;m OK, reroute me
                </button>
              )}
              <button
                onClick={() => {
                  setCheckin(null);
                  onSos("manual");
                }}
                className="btn btn-sos"
              >
                Send SOS now
              </button>
            </div>
          </div>
        </div>
      )}

      {arrived && (
        <div className="fixed inset-0 z-[95] flex items-end justify-center p-4 sm:items-center" style={{ background: "var(--scrim)" }} role="dialog" aria-modal="true" aria-labelledby="arrived-title">
          <div className="sheet-in w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-float">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-good-soft text-good" aria-hidden>
              <Check className="h-8 w-8" strokeWidth={3} />
            </span>
            <h2 id="arrived-title" className="mt-3 text-2xl font-extrabold text-ink">
              You&apos;ve arrived
            </h2>
            <p className="mt-1 text-ink-2">Let your contacts know you reached safely.</p>
            <div className="mt-5 grid gap-2">
              {contacts.length > 0 && (
                <a href={smsUri(contacts.map((c) => c.phone), `${userName} reached ${journey.destLabel} safely.`, platform)} className="btn btn-secondary">
                  Send &ldquo;reached safely&rdquo;
                </a>
              )}
              <button onClick={() => end("Arrived")} className="btn btn-good">
                End journey
              </button>
              <button
                onClick={() => {
                  arrivalSnoozedUntil.current = Date.now() + 3 * 60_000;
                  setArrived(false);
                }}
                className="btn btn-ghost btn-sm"
              >
                Not there yet
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
