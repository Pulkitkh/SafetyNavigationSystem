"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePrefs } from "@/lib/client/hooks";
import { requestMotionPermission } from "@/lib/client/shake";
import { voiceSupported } from "@/lib/client/voice";

/** Safety settings stored on this phone; they work without an account. */
export function DeviceSettings() {
  const [prefs, setPrefs] = usePrefs();
  const [motion, setMotion] = useState(true);
  const [voice, setVoice] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setMotion("DeviceMotionEvent" in window);
    setVoice(voiceSupported());
  }, []);

  const toggleShake = async (on: boolean) => {
    setNote(null);
    if (on && !(await requestMotionPermission())) {
      setNote("Motion access was refused. Allow it in your browser settings to use shake to SOS.");
      return;
    }
    setPrefs({ shakeSos: on });
  };

  const row = (title: string, text: string, checked: boolean, onChange: (v: boolean) => void, disabled = false) => (
    <label className={`flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm ${disabled ? "opacity-50" : ""}`}>
      <input type="checkbox" className="mt-1 h-5 w-5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm text-slate-700">
        <span className="block font-medium text-slate-900">{title}</span>
        {text}
      </span>
    </label>
  );

  return (
    <section className="space-y-2">
      <h2 className="font-semibold text-slate-900">On this phone</h2>
      {row(
        "Shake to SOS",
        motion ? "Shake the phone hard 4 times to start a 5-second SOS countdown. Works while SafeNav is open." : "This device has no motion sensor.",
        prefs.shakeSos,
        (v) => void toggleShake(v),
        !motion,
      )}
      {row("Voice directions", voice ? "Spoken turn-by-turn directions during a journey, so you can keep your phone away." : "Not supported here.", prefs.voice, (v) => setPrefs({ voice: v }), !voice)}
      {row("Step-free routes", "Avoid steps, unpaved and rough surfaces: for wheelchairs, walkers, strollers and older people.", prefs.stepFree, (v) => setPrefs({ stepFree: v }))}
      {note && <p className="text-sm text-amber-800">{note}</p>}
      <Link href="/fake-call" className="block rounded-2xl bg-white p-4 text-sm font-medium text-brand-700 shadow-sm">
        Fake incoming call →
      </Link>
    </section>
  );
}
