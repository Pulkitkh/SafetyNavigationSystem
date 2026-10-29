"use client";

import { MapPin, Navigation, Phone, Siren, VolumeX } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useSiren } from "@/components/Sos";
import { formatAgo } from "@/lib/client/api";
import { nativeSos } from "@/lib/client/native";
import { respond, usePeople, type Person } from "@/lib/client/people";

const SILENCED_KEY = "safenav.silencedSos";

function silenced(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(SILENCED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/**
 * On every screen: when someone who added you raises an SOS, SafeNav takes over
 * the screen and sounds an alarm until you act. (With the Android app and
 * Firebase set up, the phone rings like this even when SafeNav is closed.)
 */
export function GuardianWatch() {
  const path = usePathname();
  const { people, reload } = usePeople(15_000);
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => setDismissed(silenced()), []);

  const urgent = (people ?? []).find((p) => p.status === "sos" && p.trip && !dismissed.includes(p.trip.id) && !p.myResponse);
  if (!urgent || path.startsWith("/g/") || path.startsWith("/t/")) return null;

  const dismiss = (p: Person) => {
    const next = [...dismissed, p.trip!.id];
    setDismissed(next);
    try {
      sessionStorage.setItem(SILENCED_KEY, JSON.stringify(next));
    } catch {
      // private mode: it just shows again on reload
    }
  };

  return <SosIncoming person={urgent} onDone={() => dismiss(urgent)} onResponded={() => void reload()} />;
}

function SosIncoming({ person, onDone, onResponded }: { person: Person; onDone: () => void; onResponded: () => void }) {
  const [siren, setSiren] = useState(true);
  const [busy, setBusy] = useState(false);
  useSiren(siren);
  useEffect(() => {
    navigator.vibrate?.([800, 300, 800, 300, 800, 300, 1600]);
    // In the Android app the native alarm may be ringing; this screen takes over the sound.
    void nativeSos()
      ?.stopAlarm()
      .catch(() => {});
  }, []);
  const first = person.name.split(" ")[0];
  const act = async (response: "on_my_way" | "calling" | "called_112") => {
    setBusy(true);
    setSiren(false);
    await respond(person.userId, response).catch(() => {});
    onResponded();
    setBusy(false);
  };

  return (
    <div className="fade-in fixed inset-0 z-[130] overflow-y-auto bg-gradient-to-b from-[#b3123a] to-[#5c0a1f] text-white" role="alertdialog" aria-modal="true" aria-labelledby="incoming-title">
      <div className="pt-safe mx-auto flex min-h-full max-w-md flex-col gap-4 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mt-6 text-center">
          <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white/15 sos-pulse" aria-hidden>
            <Siren className="h-10 w-10" />
          </span>
          <p className="mt-4 text-sm font-bold uppercase tracking-widest text-white/80">Emergency SOS</p>
          <h1 id="incoming-title" className="mt-1 text-3xl font-extrabold leading-tight">
            {person.name} needs help
          </h1>
          {person.trip?.alertReason && person.trip.alertReason !== "SOS" && <p className="mt-1 text-white/90">Reason: {person.trip.alertReason}</p>}
          <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-white/85">
            <MapPin className="h-4 w-4" aria-hidden />
            {person.location ? `Location updated ${formatAgo(person.location.at)}` : "Location not available yet"}
          </p>
        </div>

        <Link href={`/people/${person.userId}`} onClick={() => setSiren(false)} className="btn min-h-16 bg-white text-lg text-red-700">
          <MapPin className="h-6 w-6" aria-hidden />
          See where {first} is
        </Link>
        <div className="grid grid-cols-2 gap-2">
          {person.phone && (
            <a href={`tel:${person.phone}`} onClick={() => void act("calling")} className="btn bg-white/15 text-white">
              <Phone className="h-5 w-5" aria-hidden />
              Call {first}
            </a>
          )}
          <a href="tel:112" onClick={() => void act("called_112")} className={`btn bg-white/15 text-white ${person.phone ? "" : "col-span-2"}`}>
            <Phone className="h-5 w-5" aria-hidden />
            Call 112
          </a>
        </div>
        <button onClick={() => void act("on_my_way")} disabled={busy} className="btn bg-[#0f7a55] text-lg text-white">
          <Navigation className="h-5 w-5" aria-hidden />
          I&apos;m on my way
        </button>
        <p className="text-center text-sm text-white/80">{first} will see your answer on their SOS screen.</p>
        <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
          <button onClick={() => setSiren((s) => !s)} className="btn text-white ring-1 ring-white/50 ring-inset" aria-pressed={!siren}>
            <VolumeX className="h-5 w-5" aria-hidden />
            {siren ? "Silence" : "Sound on"}
          </button>
          <button onClick={onDone} className="btn text-white ring-1 ring-white/50 ring-inset">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
