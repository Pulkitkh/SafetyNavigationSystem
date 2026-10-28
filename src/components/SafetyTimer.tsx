"use client";

import { Timer } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useSos } from "@/components/Sos";
import { store, type SafetyTimer } from "@/lib/client/store";
import { speak } from "@/lib/client/voice";
import { CHECKIN_TIMEOUT_S } from "@/lib/monitor";

export function useSafetyTimer(): SafetyTimer | null {
  const [timer, setTimer] = useState<SafetyTimer | null>(null);
  useEffect(() => {
    const sync = () => setTimer(store.timer());
    sync();
    window.addEventListener("safenav:timer", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("safenav:timer", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return timer;
}

export function formatClock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Watches a running safety timer on every screen. When it runs out, asks
 * "Are you OK?" and raises an SOS if there is no answer in time.
 */
export function SafetyTimerWatch() {
  const timer = useSafetyTimer();
  const sos = useSos();
  const path = usePathname();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timer]);

  const expired = !!timer && now >= timer.endsAt;
  const deadline = timer ? timer.endsAt + CHECKIN_TIMEOUT_S * 1000 : 0;

  useEffect(() => {
    if (!expired) return;
    navigator.vibrate?.([500, 200, 500, 200, 500]);
    speak("Safety timer. Are you OK? Tap I'm safe, or SOS will be sent.", true);
  }, [expired]);

  useEffect(() => {
    if (!timer || !expired || now < deadline || sos.active) return;
    store.setTimer(null);
    sos.trigger("missed_checkin", timer.note ? `safety timer ran out (${timer.note})` : "safety timer ran out");
  }, [timer, expired, now, deadline, sos]);

  if (!timer || path.startsWith("/t/")) return null;

  if (!expired) {
    // A small reminder on other screens that a timer is running.
    if (path === "/timer") return null;
    return (
      <Link
        href="/timer"
        className="fixed left-4 z-50 flex items-center gap-2 rounded-full bg-sky-600 px-3 py-2 text-sm font-semibold text-white shadow-lg"
        style={{ bottom: "calc(5.75rem + env(safe-area-inset-bottom))" }}
      >
        <Timer className="h-4 w-4" aria-hidden />
        <span className="tabular-nums">{formatClock(timer.endsAt - now)}</span>
      </Link>
    );
  }

  if (sos.active) return null;
  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="alertdialog" aria-modal="true" aria-labelledby="timer-title">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
        <h2 id="timer-title" className="text-xl font-bold text-slate-900">
          Safety timer: are you OK?
        </h2>
        {timer.note && <p className="mt-1 text-sm text-slate-600">{timer.note}</p>}
        <p className="mt-4 text-4xl font-bold tabular-nums text-red-600" aria-live="polite">
          {Math.max(0, Math.ceil((deadline - now) / 1000))}
        </p>
        <p className="text-xs text-slate-500">SOS is sent to your contacts when this reaches zero</p>
        <div className="mt-5 grid gap-2">
          <button onClick={() => store.setTimer(null)} className="rounded-xl bg-green-600 py-3 text-lg font-semibold text-white">
            I&apos;m safe
          </button>
          <button onClick={() => store.setTimer({ ...timer, endsAt: Date.now() + 10 * 60_000 })} className="rounded-xl border border-slate-300 py-2.5 font-semibold text-slate-800">
            I&apos;m OK, 10 more minutes
          </button>
          <button
            onClick={() => {
              store.setTimer(null);
              sos.trigger("manual", timer.note);
            }}
            className="rounded-xl bg-red-600 py-2.5 font-semibold text-white"
          >
            Send SOS now
          </button>
        </div>
      </div>
    </div>
  );
}
