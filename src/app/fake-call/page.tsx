"use client";

import { Mic, Phone, PhoneOff, PhoneCall, Volume2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/Nav";
import { Callout, Segmented } from "@/components/ui";
import { useWakeLock } from "@/lib/client/hooks";
import { speak, voiceSupported } from "@/lib/client/voice";

const DELAYS = [
  { s: 5, label: "5 s" },
  { s: 30, label: "30 s" },
  { s: 60, label: "1 min" },
  { s: 180, label: "3 min" },
];

const SCRIPT = [
  "Hello? Where are you right now?",
  "Okay. I'm close by, I'll meet you in five minutes.",
  "Stay on the main road, I'm on my way. Keep talking to me.",
];

const NAME_KEY = "safenav.fakeCaller";

type Phase = "setup" | "waiting" | "ringing" | "talking";

export default function FakeCallPage() {
  const [caller, setCaller] = useState("Mummy");
  const [delay, setDelay] = useState(5);
  const [phase, setPhase] = useState<Phase>("setup");
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const audio = useRef<AudioContext | null>(null);
  const timer = useRef<number | null>(null);
  useWakeLock(phase === "waiting" || phase === "ringing");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(NAME_KEY);
      if (saved) setCaller(saved);
    } catch {
      // storage unavailable; keep the default
    }
  }, []);

  useEffect(() => {
    if (phase !== "talking") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useRingtone(phase === "ringing", audio);

  useEffect(() => {
    if (phase !== "talking" || !voiceSupported()) return;
    // A voice on the line makes the call convincing to anyone nearby.
    const ids = SCRIPT.map((line, i) => window.setTimeout(() => speak(line), 1500 + i * 9000));
    return () => {
      ids.forEach(clearTimeout);
      window.speechSynthesis.cancel();
    };
  }, [phase]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    void audio.current?.close();
  }, []);

  const schedule = () => {
    try {
      localStorage.setItem(NAME_KEY, caller);
    } catch {
      // ignore
    }
    // The audio context has to be created inside a tap, or the ringtone stays silent.
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audio.current ??= new Ctx();
    void audio.current.resume();
    setPhase("waiting");
    timer.current = window.setTimeout(() => setPhase("ringing"), delay * 1000);
  };

  const hangUp = () => {
    if (timer.current) clearTimeout(timer.current);
    setPhase("setup");
  };

  if (phase === "ringing" || phase === "talking") {
    const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
    return (
      <div className="fixed inset-0 z-[120] flex flex-col items-center justify-between bg-gradient-to-b from-slate-800 to-slate-950 px-6 py-16 text-white">
        <div className="text-center">
          <p className="text-sm text-slate-300">{phase === "ringing" ? "Incoming call" : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`}</p>
          <div className="mx-auto mt-6 flex h-28 w-28 items-center justify-center rounded-full bg-slate-600 text-5xl font-semibold">
            {caller.trim().charAt(0).toUpperCase() || "?"}
          </div>
          <h1 className="mt-4 text-3xl font-semibold">{caller || "Unknown"}</h1>
          <p className="mt-1 text-slate-400">Mobile</p>
        </div>
        {phase === "ringing" ? (
          <div className="flex w-full max-w-xs justify-between">
            <button onClick={hangUp} aria-label="Decline" className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-red-600">
              <PhoneOff className="h-8 w-8" aria-hidden />
            </button>
            <button
              onClick={() => {
                setStartedAt(Date.now());
                setNow(Date.now());
                setPhase("talking");
              }}
              aria-label="Answer"
              className="flex h-[72px] w-[72px] animate-pulse items-center justify-center rounded-full bg-green-600 ring-4 ring-green-400/40"
            >
              <Phone className="h-8 w-8" aria-hidden />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-10">
            <div className="flex gap-10 text-slate-300" aria-hidden>
              <span className="flex flex-col items-center gap-1 text-xs">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
                  <Mic className="h-6 w-6" />
                </span>
                mute
              </span>
              <span className="flex flex-col items-center gap-1 text-xs">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
                  <Volume2 className="h-6 w-6" />
                </span>
                speaker
              </span>
            </div>
            <button onClick={hangUp} aria-label="End call" className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-red-600">
              <PhoneOff className="h-8 w-8" aria-hidden />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <main id="main" className="mx-auto max-w-lg pb-nav">
      <PageHeader title="Fake call" subtitle="Get a realistic incoming call to leave an uncomfortable situation." back="/safety" />
      <div className="space-y-4 px-4">
        <section className="card space-y-4 p-4">
          <div>
            <label htmlFor="caller" className="label">
              Caller name
            </label>
            <input id="caller" value={caller} onChange={(e) => setCaller(e.target.value.slice(0, 30))} className="field" autoComplete="off" />
          </div>
          <div>
            <p className="label">Ring after</p>
            <Segmented label="Ring after" value={delay} onChange={setDelay} options={DELAYS.map((d) => ({ value: d.s, label: d.label }))} />
          </div>
        </section>
        {phase === "waiting" ? (
          <div className="space-y-2">
            <Callout tone="good" icon={PhoneCall}>
              Call scheduled. Keep this screen open: the call can&apos;t ring if you lock the phone or switch apps.
            </Callout>
            <button onClick={hangUp} className="btn btn-outline w-full">
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={schedule} className="btn btn-primary w-full text-lg">
            <PhoneCall className="h-5 w-5" aria-hidden />
            Schedule fake call
          </button>
        )}
        <p className="px-1 text-[13px] text-ink-3">
          If you feel in danger, hold the SOS button or call 112 instead.{" "}
          <Link href="/help" className="font-semibold text-brand-ink underline">
            Emergency help
          </Link>
        </p>
      </div>
    </main>
  );
}

/** Indian-style ring (400 Hz, double burst) through Web Audio, with matching vibration. */
function useRingtone(on: boolean, audio: React.RefObject<AudioContext | null>) {
  useEffect(() => {
    const ctx = audio.current;
    if (!on || !ctx) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.frequency.value = 400;
    osc.connect(gain);
    osc.start();
    const ring = () => {
      const t = ctx.currentTime;
      for (const [start, end] of [
        [0, 0.4],
        [0.6, 1.0],
      ]) {
        gain.gain.setValueAtTime(0.6, t + start);
        gain.gain.setValueAtTime(0, t + end);
      }
      navigator.vibrate?.([400, 200, 400]);
    };
    ring();
    const id = setInterval(ring, 3000);
    return () => {
      clearInterval(id);
      osc.stop();
      gain.disconnect();
      navigator.vibrate?.(0);
    };
  }, [on, audio]);
}
