"use client";

import { Timer } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/Nav";
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
      <main className="mx-auto max-w-lg pb-nav">
        <PageHeader title="Safety timer running" subtitle="Check in before it ends, or your contacts get an SOS." icon={<Timer />} />
        <div className="space-y-5 px-4">
          <div className="card flex flex-col items-center p-6">
            <div className="relative h-52 w-52">
              <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90" aria-hidden>
                <circle cx="100" cy="100" r={r} fill="none" stroke="#e0f2fe" strokeWidth="12" />
                <circle cx="100" cy="100" r={r} fill="none" stroke="#0284c7" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(left / total) * c} ${c}`} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-4xl font-extrabold tabular-nums text-slate-900" aria-live="off">
                  {formatClock(left)}
                </p>
                <p className="text-xs text-slate-500">ends {new Date(timer.endsAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</p>
              </div>
            </div>
            {timer.note && <p className="mt-3 text-center text-sm text-slate-600">“{timer.note}”</p>}
          </div>
          <div className="grid gap-2">
            <button onClick={() => store.setTimer(null)} className="rounded-xl bg-green-600 py-3 text-lg font-semibold text-white shadow-md shadow-green-600/25">
              I&apos;m safe, stop the timer
            </button>
            <div className="grid grid-cols-2 gap-2">
              {[10, 30].map((m) => (
                <button key={m} onClick={() => store.setTimer({ ...timer, endsAt: timer.endsAt + m * 60_000 })} className="card py-2.5 text-sm font-semibold text-slate-800">
                  + {m} min
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Keep SafeNav open: browsers pause timers when the phone is locked. For a walk or ride, a monitored journey also tracks your route.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg pb-nav">
      <PageHeader title="Safety timer" subtitle="Walking alone, meeting someone new or waiting for a ride? Set a check-in time." icon={<Timer />} />
      <div className="space-y-4 px-4">
        <section className="card p-4">
          <p className="text-sm font-semibold text-slate-800">Check in within</p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {PRESETS.map((m) => (
              <button
                key={m}
                onClick={() => setMinutes(m)}
                aria-pressed={minutes === m}
                className={`rounded-xl py-2 text-sm font-semibold ${minutes === m ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-700"}`}
              >
                {m < 60 ? `${m} min` : `${m / 60} h`}
              </button>
            ))}
          </div>
          <label className="mt-4 block text-sm font-semibold text-slate-800">
            Where are you or who are you with? <span className="font-normal text-slate-500">(sent with the SOS)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 100))}
              placeholder="e.g. Meeting Rahul at Cafe Mocha, Vijay Nagar"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-normal"
            />
          </label>
        </section>
        <button
          onClick={() => store.setTimer({ startedAt: Date.now(), endsAt: Date.now() + minutes * 60_000, note: note.trim() || undefined })}
          className="w-full rounded-xl bg-sky-600 py-3 text-lg font-semibold text-white shadow-md shadow-sky-600/25"
        >
          Start {minutes < 60 ? `${minutes}-minute` : `${minutes / 60}-hour`} timer
        </button>
        {contacts.length === 0 && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            You have no trusted contacts yet, so an SOS can only open your SMS app. <Link href="/contacts" className="font-semibold underline">Add contacts</Link>
          </p>
        )}
        <p className="text-xs text-slate-500">When the time is up SafeNav asks “Are you OK?”. If you don&apos;t answer within 60 seconds, it sends an SOS with your location.</p>
      </div>
    </main>
  );
}
