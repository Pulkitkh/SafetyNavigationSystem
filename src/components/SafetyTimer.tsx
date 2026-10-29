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

  if (!timer || path.startsWith("/t/") || path.startsWith("/g/")) return null;

  if (!expired) {
    // A small reminder on other screens that a timer is running.
    if (path === "/timer") return null;
    return (
      <Link
        href="/timer"
        aria-label={`Safety timer running, ${formatClock(timer.endsAt - now)} left`}
        className="fixed right-3 z-40 flex min-h-11 items-center gap-2 rounded-full bg-info px-4 text-sm font-bold text-white shadow-float dark:text-[#06142b]"
        style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <Timer className="h-4 w-4" aria-hidden />
        <span className="tabular-nums">{formatClock(timer.endsAt - now)}</span>
      </Link>
    );
  }

  if (sos.active) return null;
  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center p-4 sm:items-center" style={{ background: "var(--scrim)" }} role="alertdialog" aria-modal="true" aria-labelledby="timer-title">
      <div className="sheet-in w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-float">
        <h2 id="timer-title" className="text-2xl font-extrabold text-ink">
          Safety timer: are you OK?
        </h2>
        {timer.note && <p className="mt-1 text-[15px] text-ink-2">{timer.note}</p>}
        <p className="mt-4 text-5xl font-extrabold tabular-nums text-sos" aria-live="polite">
          {Math.max(0, Math.ceil((deadline - now) / 1000))}
        </p>
        <p className="text-[13px] text-ink-3">SOS is sent to your contacts when this reaches zero</p>
        <div className="mt-5 grid gap-2">
          <button onClick={() => store.setTimer(null)} className="btn btn-good text-lg">
            I&apos;m safe
          </button>
          <button onClick={() => store.setTimer({ ...timer, endsAt: Date.now() + 10 * 60_000 })} className="btn btn-outline">
            I&apos;m OK, 10 more minutes
          </button>
          <button
            onClick={() => {
              store.setTimer(null);
              sos.trigger("manual", timer.note);
            }}
            className="btn btn-sos"
          >
            Send SOS now
          </button>
        </div>
      </div>
    </div>
  );
}
