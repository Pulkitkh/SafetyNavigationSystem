"use client";

import { ChevronRight, LifeBuoy, MessageSquareWarning, PhoneCall, ScanSearch, ShieldCheck, Timer, Users, Vibrate, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/Nav";
import { useSafetyTimer } from "@/components/SafetyTimer";
import { usePrefs, useSession } from "@/lib/client/hooks";

const TOOLS: { href: string; title: string; text: string; icon: LucideIcon; cls: string }[] = [
  { href: "/area", title: "Is it safe here?", text: "Live check of lights, open places, police and reports around you", icon: ScanSearch, cls: "bg-emerald-50 text-emerald-700" },
  { href: "/timer", title: "Safety timer", text: "Check in by a set time, or SafeNav sends SOS for you", icon: Timer, cls: "bg-sky-50 text-sky-700" },
  { href: "/fake-call", title: "Fake incoming call", text: "A realistic call with a voice, to leave an uncomfortable situation", icon: PhoneCall, cls: "bg-violet-50 text-violet-700" },
  { href: "/report", title: "Report an unsafe spot", text: "Harassment, dark stretches, stray dogs: warn others and improve routes", icon: MessageSquareWarning, cls: "bg-rose-50 text-rose-700" },
  { href: "/help", title: "Nearby help & helplines", text: "Police, hospitals, 24-hour pharmacies and India's emergency numbers", icon: LifeBuoy, cls: "bg-amber-50 text-amber-700" },
  { href: "/contacts", title: "Trusted contacts", text: "Who gets your live location and SOS messages", icon: Users, cls: "bg-indigo-50 text-indigo-700" },
];

export default function SafetyPage() {
  const timer = useSafetyTimer();
  const [prefs] = usePrefs();
  const { contacts } = useSession();
  return (
    <main className="mx-auto max-w-lg pb-nav">
      <PageHeader title="Safety tools" subtitle="Everything that helps when you're out alone." icon={<ShieldCheck />} />
      <div className="space-y-3 px-4">
        <div className="flex flex-wrap gap-2 text-xs font-medium">
          <span className={`rounded-full px-3 py-1 ${contacts.length ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}>
            {contacts.length ? `${contacts.length} trusted contact${contacts.length > 1 ? "s" : ""}` : "No trusted contacts yet"}
          </span>
          <span className={`flex items-center gap-1 rounded-full px-3 py-1 ${prefs.shakeSos ? "bg-green-50 text-green-800" : "bg-slate-100 text-slate-600"}`}>
            <Vibrate className="h-3.5 w-3.5" aria-hidden /> Shake to SOS {prefs.shakeSos ? "on" : "off"}
          </span>
          {timer && <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-800">Safety timer running</span>}
        </div>
        <ul className="space-y-2">
          {TOOLS.map((t) => (
            <li key={t.href}>
              <Link href={t.href} className="card flex items-center gap-3 p-3.5 transition hover:-translate-y-0.5">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${t.cls}`}>
                  <t.icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-900">{t.title}</span>
                  <span className="block text-xs text-slate-500">{t.text}</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
        <p className="px-1 text-xs text-slate-500">
          The red SOS button is on every screen: press and hold it to alert your contacts, share your live location and call 112.
        </p>
      </div>
    </main>
  );
}
