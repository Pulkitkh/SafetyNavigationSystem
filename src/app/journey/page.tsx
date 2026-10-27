"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { type MapMarker } from "@/components/Map";
import { useSos } from "@/components/Sos";
import { api, formatDistance } from "@/lib/client/api";
import { batteryLevel, useGeolocation, useSession, useWakeLock } from "@/lib/client/hooks";
import { store, type ActiveJourney } from "@/lib/client/store";
import { distanceToPolyline, type LngLat } from "@/lib/geo";
import { ANOMALY_TEXT, CHECKIN_TIMEOUT_S, evaluate, initialMonitorState, MONITOR_CONFIG, snooze, type Anomaly, type Fix } from "@/lib/monitor";
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
  const geo = useGeolocation(!!journey, true);
  useWakeLock(!!journey);

  useEffect(() => {
    const j = store.journey();
    setJourney(j);
    setIsNew(new URLSearchParams(window.location.search).get("new") === "1");
    if (!j) {
      api<{ trip: { id: string; destLabel: string } | null }>("/api/trips")
        .then(({ trip }) => setRemote(trip))
        .catch(() => {})
        .finally(() => setLoaded(true));
    } else setLoaded(true);
  }, []);

  if (!loaded) return <main className="p-6 text-slate-600">Loading…</main>;
  if (!journey) {
    return (
      <main className="mx-auto max-w-lg p-6 pb-nav">
        <h1 className="text-xl font-bold">No journey in progress</h1>
        {remote ? (
          <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p>A journey to {remote.destLabel} is still being shared from another device.</p>
            <button
              onClick={async () => {
                await api(`/api/trips/${remote.id}`, { method: "PATCH", json: { status: "ended", reason: "Ended from another device" } }).catch(() => {});
                setRemote(null);
              }}
              className="mt-3 rounded-lg bg-amber-600 px-4 py-2 font-medium text-white"
            >
              End that journey
            </button>
          </div>
        ) : (
          <p className="mt-2 text-slate-600">Plan a route and tap “Start journey” to share your trip live with your contacts.</p>
        )}
        <Link href="/" className="mt-6 inline-block rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white">
          Plan a route
        </Link>
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
  const lastPush = useRef(0);
  const arrivalSnoozedUntil = useRef(0);
  const liveUrl = typeof window !== "undefined" ? `${window.location.origin}/t/${journey.shareToken}` : "";
  const shareText = journeyMessage(userName, journey.destLabel, liveUrl, new Date(journey.expectedArrival), journey.vehicle);

  useEffect(() => setPlatform(detectPlatform(navigator.userAgent)), []);
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
    if (fixes.length) setRemainingM(r.remainingM);
    if (r.arrived && now > arrivalSnoozedUntil.current) {
      setArrived(true);
      setCheckin(null);
      return;
    }
    if (r.anomaly && !checkin) {
      setCheckin({ anomaly: r.anomaly, deadline: Date.now() + CHECKIN_TIMEOUT_S * 1000 });
      void setStatus("alert", ANOMALY_TEXT[r.anomaly]);
      if (navigator.vibrate) navigator.vibrate([400, 200, 400]);
    }
  }, [geo.history, now, arrived, sosActive, checkin, journey, cfg, setStatus]);

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

  return (
    <main className="flex h-dvh flex-col md:flex-row">
      <section className="relative min-h-[45dvh] flex-1 md:order-2">
        <Map
          routes={[{ id: "route", coordinates: journey.route }]}
          selectedId="route"
          user={here ? { point: here, accuracy: geo.fix?.accuracy } : null}
          markers={markers}
          fitKey={journey.tripId}
          followUser
        />
        {nextStep && !arrived && (
          <div className="absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] rounded-2xl bg-slate-900/90 px-4 py-3 text-white shadow-lg">
            <p className="text-base font-semibold">{nextStep.instruction}</p>
            {nextStepDist != null && <p className="text-sm text-slate-300">in {formatDistance(nextStepDist)}</p>}
          </div>
        )}
      </section>

      <section className="max-h-[55dvh] space-y-3 overflow-y-auto bg-slate-50 p-4 pb-nav md:order-1 md:max-h-none md:w-[400px]">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-green-700">{journey.mode === "ride" ? "Ride monitoring on" : "Journey shared live"}</p>
            <h1 className="text-lg font-bold text-slate-900">To {journey.destLabel}</h1>
            {journey.vehicle && <p className="text-sm text-slate-600">{journey.vehicle}</p>}
          </div>
          <div className="text-right text-sm">
            <p className={late ? "font-semibold text-amber-700" : "text-slate-700"}>ETA {eta}</p>
            {remainingM != null && <p className="text-slate-500">{formatDistance(remainingM)} left</p>}
          </div>
        </div>

        {geo.error && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{geo.error}</p>}
        {offline && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">No connection — your contacts see your last known position. SOS by SMS still works.</p>}

        {(isNew || contacts.length === 0) && (
          <div className="rounded-2xl border border-brand-100 bg-brand-50 p-4 text-sm">
            <p className="font-semibold text-brand-700">Send the live link to your contacts</p>
            {contacts.length === 0 ? (
              <p className="mt-1 text-slate-700">
                You have no trusted contacts yet. <Link href="/contacts" className="text-brand-600 underline">Add them</Link> or share the link manually.
              </p>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              {contacts.length > 0 && (
                <a href={smsUri(contacts.map((c) => c.phone), shareText, platform)} className="rounded-lg bg-brand-600 px-3 py-2 text-center font-medium text-white">
                  SMS contacts
                </a>
              )}
              {contacts[0] && (
                <a href={whatsappUri(contacts[0].phone, shareText)} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-green-600 px-3 py-2 text-center font-medium text-white">
                  WhatsApp {contacts[0].name.split(" ")[0]}
                </a>
              )}
              <button onClick={share} className="col-span-2 rounded-lg border border-brand-500 px-3 py-2 font-medium text-brand-700">
                Share link…
              </button>
            </div>
          </div>
        )}

        {!isNew && contacts.length > 0 && (
          <button onClick={share} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800">
            Share live link again
          </button>
        )}

        <div className="rounded-2xl bg-white p-4 text-sm text-slate-600">
          <p className="font-medium text-slate-800">SafeNav is watching for</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            <li>leaving the route by more than {cfg.offRouteM} m</li>
            <li>no movement for {Math.round(cfg.stoppedForMs / 60_000)} minutes</li>
            <li>arriving more than {Math.round(cfg.overdueGraceMs / 60_000)} minutes late</li>
          </ul>
          <p className="mt-2">Keep this screen open: phones pause location in the background.</p>
        </div>

        {confirmEnd ? (
          <div className="flex gap-2">
            <button onClick={() => end("Ended by user")} className="flex-1 rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white">
              End journey
            </button>
            <button onClick={() => setConfirmEnd(false)} className="flex-1 rounded-xl border border-slate-300 px-4 py-3">
              Keep going
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmEnd(true)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-medium text-slate-800">
            I&apos;ve arrived / end journey
          </button>
        )}
      </section>

      {checkin && !sosActive && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="alertdialog" aria-modal="true" aria-labelledby="checkin-title">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
            <h2 id="checkin-title" className="text-xl font-bold text-slate-900">
              Are you OK?
            </h2>
            <p className="mt-1 text-slate-600">{ANOMALY_TEXT[checkin.anomaly]}</p>
            <p className="mt-4 text-4xl font-bold tabular-nums text-red-600" aria-live="polite">
              {Math.max(0, Math.ceil((checkin.deadline - now) / 1000))}
            </p>
            <p className="text-xs text-slate-500">{autoSos ? "SOS is sent automatically when the timer ends" : "Automatic SOS is off in your settings"}</p>
            <div className="mt-5 grid gap-2">
              <button onClick={answerOk} className="rounded-xl bg-green-600 py-3 text-lg font-semibold text-white">
                I&apos;m OK
              </button>
              <button
                onClick={() => {
                  setCheckin(null);
                  onSos("manual");
                }}
                className="rounded-xl bg-red-600 py-3 font-semibold text-white"
              >
                Send SOS now
              </button>
            </div>
          </div>
        </div>
      )}

      {arrived && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="arrived-title">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
            <h2 id="arrived-title" className="text-xl font-bold text-green-700">
              You&apos;ve arrived
            </h2>
            <p className="mt-1 text-slate-600">Let your contacts know you reached safely.</p>
            <div className="mt-4 grid gap-2">
              {contacts.length > 0 && (
                <a
                  href={smsUri(contacts.map((c) => c.phone), `${userName} reached ${journey.destLabel} safely.`, platform)}
                  className="rounded-xl bg-brand-600 py-3 font-semibold text-white"
                >
                  Send “reached safely”
                </a>
              )}
              <button onClick={() => end("Arrived")} className="rounded-xl bg-green-600 py-3 font-semibold text-white">
                End journey
              </button>
              <button
                onClick={() => {
                  arrivalSnoozedUntil.current = Date.now() + 3 * 60_000;
                  setArrived(false);
                }}
                className="text-sm text-slate-500 underline"
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
