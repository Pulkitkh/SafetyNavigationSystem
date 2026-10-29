"use client";

import { Check, Timer, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertsCard } from "@/components/AlertsCard";
import { PageHeader } from "@/components/Nav";
import { Callout } from "@/components/ui";
import { formatClock, useSafetyTimer } from "@/components/SafetyTimer";
import { useSession, useWakeLock } from "@/lib/client/hooks";
import { store } from "@/lib/client/store";

const PRESETS = [5, 10, 15, 30, 45, 60, 90, 120];

export default function TimerPage() {
  const timer = useSafetyTimer();
  const { contacts } = useSession();
  const [minutes, setMinutes] = useState(15);
  const [note, setNote] = useState("");
  const [now, setNow] = useState(Date.now());
  useWakeLock(!!timer);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (timer) {
    const total = timer.endsAt - timer.startedAt;
    const left = Math.max(0, timer.endsAt - now);
    const r = 92;
    const c = 2 * Math.PI * r;
    return (
      <main id="main" className="mx-auto max-w-lg pb-nav">
        <PageHeader title="Safety timer running" subtitle="Check in before it ends, or your contacts get an SOS." back="/safety" />
        <div className="space-y-5 px-4">
          <div className="card flex flex-col items-center p-6">
            <div className="relative h-52 w-52">
              <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90" aria-hidden>
                <circle cx="100" cy="100" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="12" />
                <circle cx="100" cy="100" r={r} fill="none" stroke="var(--info)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(left / total) * c} ${c}`} style={{ transition: "stroke-dasharray 1s linear" }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-5xl font-extrabold tabular-nums text-ink" aria-live="off">
                  {formatClock(left)}
                </p>
                <p className="mt-1 text-sm text-ink-2">ends {new Date(timer.endsAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</p>
              </div>
            </div>
            {timer.note && <p className="mt-3 text-center text-[15px] text-ink-2">&ldquo;{timer.note}&rdquo;</p>}
          </div>
          <div className="grid gap-2">
            <button onClick={() => store.setTimer(null)} className="btn btn-good text-lg">
              <Check className="h-5 w-5" strokeWidth={3} aria-hidden />
              I&apos;m safe, stop the timer
            </button>
            <div className="grid grid-cols-2 gap-2">
              {[10, 30].map((m) => (
                <button key={m} onClick={() => store.setTimer({ ...timer, endsAt: timer.endsAt + m * 60_000 })} className="btn btn-outline">
                  + {m} min
                </button>
              ))}
            </div>
          </div>
          <AlertsCard compact />
          <p className="px-1 text-[13px] text-ink-3">
            Signed in, the timer also runs on SafeNav&apos;s server: if your phone is switched off or SafeNav is closed when it ends, your contacts still get the
            SOS, with your last shared location. For a walk or ride, a monitored journey also tracks your route.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="mx-auto max-w-lg pb-nav">
      <PageHeader title="Safety timer" subtitle="Walking alone, meeting someone new or waiting for a ride? Set a check-in time." back="/safety" />
      <div className="space-y-4 px-4">
        <section className="card p-4">
          <p className="label">Check in within</p>
          <div className="mt-1 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Check-in time">
            {PRESETS.map((m) => (
              <button
                key={m}
                onClick={() => setMinutes(m)}
                role="radio"
                aria-checked={minutes === m}
                data-on={minutes === m}
                className="chip justify-center rounded-2xl"
              >
                {m < 60 ? `${m} min` : `${m / 60} h`}
              </button>
            ))}
          </div>
          <label className="label mt-4">
            Where are you or who are you with? <span className="font-normal text-ink-3">(sent with the SOS)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 100))}
              placeholder="e.g. Meeting Rahul at Cafe Mocha, Vijay Nagar"
              className="field mt-1.5 font-normal"
            />
          </label>
        </section>
        <button
          onClick={() => store.setTimer({ startedAt: Date.now(), endsAt: Date.now() + minutes * 60_000, note: note.trim() || undefined })}
          className="btn btn-primary w-full text-lg"
        >
          <Timer className="h-5 w-5" aria-hidden />
          Start {minutes < 60 ? `${minutes}-minute` : `${minutes / 60}-hour`} timer
        </button>
        {contacts.length === 0 && (
          <Callout tone="caution" icon={UserPlus}>
            You have no trusted contacts yet, so an SOS can&apos;t alert anyone automatically.{" "}
            <Link href="/contacts" className="font-bold underline">
              Add contacts
            </Link>
          </Callout>
        )}
        <p className="px-1 text-[13px] text-ink-3">When the time is up SafeNav asks “Are you OK?”. If you don&apos;t answer within 60 seconds, it sends an SOS with your location.</p>
      </div>
    </main>
  );
}
