"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, newShareToken } from "@/lib/client/api";
import { useGeolocation, usePrefs, useSession, batteryLevel } from "@/lib/client/hooks";
import { useShake } from "@/lib/client/shake";
import { store } from "@/lib/client/store";
import { detectPlatform, EMERGENCY_NUMBERS, smsUri, sosMessage, whatsappUri } from "@/lib/sos";

type Trigger = "manual" | "missed_checkin" | "deviation";

interface SosState {
  trigger: Trigger;
  token: string;
  tripId: string | null;
  liveUrl: string | null;
  message: string;
  server: "pending" | "ok" | "failed" | "skipped";
  serverError?: string;
  gateway: { provider: string; delivered: number; failed: number } | null;
  startedAt: number;
}

interface SosApi {
  active: boolean;
  trigger: (trigger?: Trigger) => void;
}

const SosContext = createContext<SosApi | null>(null);

export function useSos() {
  const ctx = useContext(SosContext);
  if (!ctx) throw new Error("useSos must be used inside SosProvider");
  return ctx;
}

const SHAKE_COUNTDOWN_S = 5;

const REASON: Record<Trigger, string | null> = {
  manual: null,
  missed_checkin: "missed a safety check-in",
  deviation: "unexpected route change",
};

export function SosProvider({ children }: { children: ReactNode }) {
  const { me, contacts } = useSession();
  const [sos, setSos] = useState<SosState | null>(null);
  const [shakeCountdown, setShakeCountdown] = useState<number | null>(null);
  const [prefs] = usePrefs();
  const geo = useGeolocation(!!sos);

  const trigger = useCallback(
    (trigger: Trigger = "manual") => {
      if (sos) return;
      const journey = store.journey();
      const token = journey?.shareToken ?? newShareToken();
      const fix = store.lastFix();
      const name = me?.name ?? store.userName() ?? "Your contact";
      const liveUrl = me ? `${window.location.origin}/t/${token}` : null;
      const message = sosMessage({
        name,
        liveUrl,
        lat: fix?.lat,
        lng: fix?.lng,
        accuracyM: fix?.accuracy,
        vehicle: journey?.vehicle,
        reason: REASON[trigger],
      });
      if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]);
      const state: SosState = {
        trigger,
        token,
        tripId: journey?.tripId ?? null,
        liveUrl,
        message,
        server: me ? "pending" : "skipped",
        gateway: null,
        startedAt: Date.now(),
      };
      setSos(state);
      if (!me) return;
      api<{ tripId: string; liveUrl: string | null; message: string; gateway: { provider: string; results: { ok: boolean }[] } | null }>("/api/sos", {
        method: "POST",
        json: {
          shareToken: token,
          tripId: journey?.tripId,
          lat: fix?.lat,
          lng: fix?.lng,
          accuracy: fix?.accuracy,
          trigger,
        },
      })
        .then((res) =>
          setSos((s) =>
            s && {
              ...s,
              server: "ok",
              tripId: res.tripId,
              liveUrl: res.liveUrl ?? s.liveUrl,
              message: res.liveUrl ? s.message : res.message,
              gateway: res.gateway && {
                provider: res.gateway.provider,
                delivered: res.gateway.results.filter((r) => r.ok).length,
                failed: res.gateway.results.filter((r) => !r.ok).length,
              },
            },
          ),
        )
        .catch((err: Error) => setSos((s) => s && { ...s, server: "failed", serverError: err.message }));
    },
    [me, sos],
  );

  // While an SOS is open, keep the live link updated every 10 s.
  const fixRef = useRef(geo.fix);
  fixRef.current = geo.fix;
  useEffect(() => {
    if (!sos?.tripId || sos.server !== "ok") return;
    const push = async () => {
      const f = fixRef.current;
      if (!f) return;
      await api(`/api/trips/${sos.tripId}/location`, {
        method: "POST",
        json: { lat: f.lat, lng: f.lng, accuracy: f.accuracy, battery: await batteryLevel(), at: f.at },
      }).catch(() => {});
    };
    void push();
    const id = setInterval(push, 10_000);
    return () => clearInterval(id);
  }, [sos?.tripId, sos?.server]);

  // Shake to SOS: hard shakes start a short countdown the user can cancel.
  useShake(prefs.shakeSos && !sos && shakeCountdown == null, () => {
    navigator.vibrate?.([200, 100, 200]);
    setShakeCountdown(SHAKE_COUNTDOWN_S);
  });
  useEffect(() => {
    if (shakeCountdown == null) return;
    if (shakeCountdown <= 0) {
      setShakeCountdown(null);
      trigger("manual");
      return;
    }
    const id = setTimeout(() => setShakeCountdown((n) => (n == null ? null : n - 1)), 1000);
    return () => clearTimeout(id);
  }, [shakeCountdown, trigger]);

  const close = useCallback(async (markSafe: boolean) => {
    if (markSafe && sos?.tripId) {
      await api(`/api/trips/${sos.tripId}`, { method: "PATCH", json: { status: "ended", reason: "Marked safe" } }).catch(() => {});
      if (store.journey()?.tripId === sos.tripId) store.setJourney(null);
    }
    setSos(null);
  }, [sos?.tripId]);

  return (
    <SosContext.Provider value={{ active: !!sos, trigger }}>
      {children}
      {sos && <SosSheet sos={sos} contacts={contacts} signedIn={!!me} gpsError={geo.error} onClose={close} />}
      {shakeCountdown != null && !sos && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-red-700/95 p-6 text-center text-white" role="alertdialog" aria-modal="true" aria-labelledby="shake-title">
          <div className="w-full max-w-sm">
            <h2 id="shake-title" className="text-2xl font-bold">
              Shake detected
            </h2>
            <p className="mt-1 text-red-100">Sending SOS in</p>
            <p className="my-4 text-7xl font-extrabold tabular-nums" aria-live="assertive">
              {shakeCountdown}
            </p>
            <div className="grid gap-2">
              <button
                onClick={() => {
                  setShakeCountdown(null);
                  trigger("manual");
                }}
                className="rounded-xl bg-white py-3 text-lg font-bold text-red-700"
              >
                Send SOS now
              </button>
              <button onClick={() => setShakeCountdown(null)} className="rounded-xl border border-white/70 py-3 font-semibold">
                Cancel, I&apos;m fine
              </button>
            </div>
          </div>
        </div>
      )}
    </SosContext.Provider>
  );
}

function SosSheet({
  sos,
  contacts,
  signedIn,
  gpsError,
  onClose,
}: {
  sos: SosState;
  contacts: { name: string; phone: string; relation: string }[];
  signedIn: boolean;
  gpsError: string | null;
  onClose: (markSafe: boolean) => void;
}) {
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const [siren, setSiren] = useState(false);
  const [confirmSafe, setConfirmSafe] = useState(false);
  useEffect(() => setPlatform(detectPlatform(navigator.userAgent)), []);
  useSiren(siren);

  const phones = contacts.map((c) => c.phone);
  const share = async () => {
    try {
      await navigator.share({ title: "SOS", text: sos.message });
    } catch {
      await navigator.clipboard?.writeText(sos.message).catch(() => {});
    }
  };
  const gatewayAll = sos.gateway && sos.gateway.delivered > 0 && sos.gateway.failed === 0;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col overflow-y-auto bg-red-700 text-white" role="alertdialog" aria-modal="true" aria-labelledby="sos-title">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 p-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-red-100">{sos.trigger === "manual" ? "SOS activated" : "Automatic SOS"}</p>
          <h1 id="sos-title" className="text-2xl font-bold">
            {sos.trigger === "missed_checkin" ? "You didn't answer the safety check-in" : "Get help now"}
          </h1>
        </div>

        <a href="tel:112" className="flex items-center justify-between rounded-2xl bg-white px-5 py-4 text-red-700 shadow-lg">
          <span className="text-xl font-bold">Call 112</span>
          <span className="text-sm font-medium">Police · Fire · Ambulance</span>
        </a>

        <section className="rounded-2xl bg-red-800/60 p-4">
          <h2 className="font-semibold">Alert your trusted contacts</h2>
          <StatusLine sos={sos} signedIn={signedIn} gatewayAll={!!gatewayAll} />
          {contacts.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2">
              <a
                href={smsUri(phones, sos.message, platform)}
                className="rounded-xl bg-white px-4 py-3 text-center font-semibold text-red-700"
              >
                {gatewayAll ? "Also send from my phone (SMS)" : `Send SMS to ${contacts.length} contact${contacts.length > 1 ? "s" : ""}`}
              </a>
              <div className="grid grid-cols-2 gap-2">
                {contacts.map((c) => (
                  <a
                    key={c.phone}
                    href={whatsappUri(c.phone, sos.message)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate rounded-xl bg-green-600 px-3 py-2 text-center text-sm font-medium"
                  >
                    WhatsApp {c.name.split(" ")[0]}
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              <a href={smsUri([], sos.message, platform)} className="rounded-xl bg-white px-4 py-3 text-center font-semibold text-red-700">
                Send SMS (choose recipients)
              </a>
              <Link href="/contacts" onClick={() => onClose(false)} className="text-center text-sm underline">
                Add trusted contacts for one-tap alerts
              </Link>
            </div>
          )}
          <button onClick={share} className="mt-2 w-full rounded-xl border border-white/60 px-4 py-2 text-sm font-medium">
            Share via another app
          </button>
        </section>

        <details className="rounded-2xl bg-red-800/40 p-4 text-sm">
          <summary className="cursor-pointer font-semibold">Message that will be sent</summary>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-red-50">{sos.message}</pre>
          {gpsError && <p className="mt-2 text-red-100">{gpsError}</p>}
        </details>

        <section className="grid grid-cols-2 gap-2 text-sm">
          {EMERGENCY_NUMBERS.filter((n) => n.number !== "112").slice(0, 4).map((n) => (
            <a key={n.number} href={`tel:${n.number}`} className="rounded-xl bg-red-800/60 px-3 py-2">
              <span className="block text-lg font-bold">{n.number}</span>
              {n.label}
            </a>
          ))}
        </section>

        <button
          onClick={() => setSiren((s) => !s)}
          className={`rounded-xl px-4 py-3 font-semibold ${siren ? "bg-yellow-300 text-red-900" : "border border-white/60"}`}
          aria-pressed={siren}
        >
          {siren ? "Stop alarm sound" : "Sound loud alarm"}
        </button>

        <div className="mt-auto pb-[env(safe-area-inset-bottom)]">
          {confirmSafe ? (
            <div className="flex gap-2">
              <button onClick={() => onClose(true)} className="flex-1 rounded-xl bg-white px-4 py-3 font-semibold text-red-700">
                Yes, I&apos;m safe
              </button>
              <button onClick={() => setConfirmSafe(false)} className="flex-1 rounded-xl border border-white/60 px-4 py-3">
                Keep SOS on
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmSafe(true)} className="w-full rounded-xl border border-white/60 px-4 py-3 text-sm">
              I&apos;m safe now — end SOS
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusLine({ sos, signedIn, gatewayAll }: { sos: SosState; signedIn: boolean; gatewayAll: boolean }) {
  if (!signedIn) return <p className="mt-1 text-sm text-red-100">Not signed in: your message includes a map link but no live tracking.</p>;
  if (sos.server === "pending") return <p className="mt-1 text-sm text-red-100">Creating your live tracking link…</p>;
  if (sos.server === "failed")
    return <p className="mt-1 text-sm text-red-100">Couldn&apos;t reach the server ({sos.serverError}). The SMS below still contains your location.</p>;
  if (sos.gateway) {
    return (
      <p className="mt-1 text-sm text-red-100">
        {gatewayAll
          ? `SMS sent automatically to ${sos.gateway.delivered} contact${sos.gateway.delivered > 1 ? "s" : ""}. Live location is being shared.`
          : `Automatic SMS: ${sos.gateway.delivered} sent, ${sos.gateway.failed} failed. Send from your phone too.`}
      </p>
    );
  }
  return <p className="mt-1 text-sm text-red-100">Live location link is active and updating. Tap below to send it.</p>;
}

/** Loud two-tone alarm through Web Audio; works without any audio file. */
function useSiren(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    gain.gain.value = 0.9;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    let high = false;
    const id = setInterval(() => {
      high = !high;
      osc.frequency.setValueAtTime(high ? 1400 : 900, ctx.currentTime);
    }, 350);
    return () => {
      clearInterval(id);
      osc.stop();
      void ctx.close();
    };
  }, [on]);
}

/** Floating press-and-hold SOS button. Holding avoids pocket and accidental taps. */
export function SosButton() {
  const { trigger, active } = useSos();
  const path = usePathname();
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState(false);
  const timer = useRef<number | null>(null);
  const HOLD_MS = 1200;

  const start = () => {
    const t0 = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        timer.current = null;
        setProgress(0);
        trigger("manual");
        return;
      }
      timer.current = requestAnimationFrame(tick);
    };
    timer.current = requestAnimationFrame(tick);
  };
  const cancel = () => {
    if (timer.current != null) {
      cancelAnimationFrame(timer.current);
      timer.current = null;
      if (progress < 0.25) {
        setHint(true);
        setTimeout(() => setHint(false), 2200);
      }
    }
    setProgress(0);
  };

  // The live-tracking page is opened by guardians, not by the person at risk.
  if (active || path.startsWith("/t/")) return null;
  return (
    <div className="fixed right-4 z-50" style={{ bottom: "calc(5.25rem + env(safe-area-inset-bottom))" }}>
      {hint && <div className="absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white">Hold to send SOS</div>}
      <button
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && timer.current == null && !e.repeat) start();
        }}
        onKeyUp={cancel}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="SOS. Press and hold to alert your contacts and call for help"
        className="sos-pulse relative flex h-16 w-16 select-none items-center justify-center rounded-full bg-sos text-lg font-extrabold text-white shadow-xl touch-none"
      >
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 64 64" aria-hidden>
          <circle cx="32" cy="32" r="29" fill="none" stroke="white" strokeWidth="4" strokeDasharray={`${progress * 182} 182`} strokeLinecap="round" />
        </svg>
        SOS
      </button>
    </div>
  );
}
