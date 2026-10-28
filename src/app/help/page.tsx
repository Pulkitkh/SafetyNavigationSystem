"use client";

import { Fuel, Hospital, LifeBuoy, Navigation, Phone, Pill, Shield, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DeviceSettings } from "@/components/DeviceSettings";
import { PageHeader } from "@/components/Nav";
import { api, formatDistance } from "@/lib/client/api";
import { useGeolocation } from "@/lib/client/hooks";
import { EMERGENCY_NUMBERS } from "@/lib/sos";

interface Place {
  id: string;
  name?: string;
  phone?: string;
  openingHours?: string;
  point: [number, number];
  distance: number;
  openNow: boolean | null;
}

interface Help {
  police: Place[];
  hospitals: Place[];
  pharmacies: Place[];
  fuel: Place[];
}

const TIPS = [
  "Before getting into a cab or auto, check the number plate matches the app and share it with SafeNav's ride monitoring.",
  "Sit behind the driver in a cab, keep the window controls in reach and check the child lock is off.",
  "Prefer busy, lit main roads after dark even if they take a few minutes longer.",
  "Keep your phone charged; SafeNav shares your battery level with contacts during a journey.",
  "The 112 India app and Himmat Plus (Delhi Police) also send SOS directly to police.",
  "Petrol pumps, hospitals and 24-hour pharmacies are good places to wait for help.",
];

function OpenBadge({ open }: { open: boolean | null }) {
  if (open == null) return null;
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${open ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-500"}`}>
      {open ? "Open now" : "Closed"}
    </span>
  );
}

export default function HelpPage() {
  const geo = useGeolocation();
  const [help, setHelp] = useState<Help | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!geo.fix || requested) return;
    setRequested(true);
    api<Help>(`/api/places/help?lat=${geo.fix.lat}&lng=${geo.fix.lng}`)
      .then(setHelp)
      .catch((err: Error) => setError(err.message));
  }, [geo.fix, requested]);

  const section = (title: string, icon: LucideIcon, places: Place[] | undefined, empty: string, single: string) => {
    const Icon = icon;
    return (
      <section className="card px-4 py-2">
        <h2 className="flex items-center gap-2 pt-2 text-sm font-semibold text-slate-900">
          <Icon className="h-4 w-4 text-brand-600" aria-hidden />
          {title}
        </h2>
        {!places ? (
          <p className="py-3 text-sm text-slate-500">{error ?? (geo.error || "Finding places near you…")}</p>
        ) : places.length === 0 ? (
          <p className="py-3 text-sm text-slate-500">{empty}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {places.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 font-medium text-slate-900">
                    <span className="truncate">{p.name ?? single}</span>
                    <OpenBadge open={p.openNow} />
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {formatDistance(p.distance)} away{p.openingHours ? ` · ${p.openingHours}` : ""}
                  </p>
                </div>
                {p.phone && (
                  <a href={`tel:${p.phone.split(";")[0].replace(/\s/g, "")}`} aria-label={`Call ${p.name ?? single}`} className="rounded-full bg-slate-100 p-2 text-slate-800">
                    <Phone className="h-4 w-4" />
                  </a>
                )}
                <Link
                  href={`/?to=${p.point[0]},${p.point[1]}&label=${encodeURIComponent(p.name ?? single)}`}
                  className="flex items-center gap-1 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  <Navigation className="h-3.5 w-3.5" aria-hidden />
                  Safe route
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  return (
    <main className="mx-auto max-w-lg pb-nav">
      <PageHeader title="Help" subtitle="Emergency numbers work even without balance or mobile data." icon={<LifeBuoy />} />
      <div className="space-y-4 px-4">
        <ul className="grid grid-cols-2 gap-2">
          {EMERGENCY_NUMBERS.map((n) => {
            const primary = "primary" in n && n.primary;
            return (
              <li key={n.number} className={primary ? "col-span-2" : ""}>
                <a
                  href={`tel:${n.number}`}
                  className={`flex items-center gap-3 rounded-2xl p-3 ${primary ? "bg-gradient-to-br from-rose-600 to-red-700 text-white shadow-lg shadow-red-600/25" : "card text-slate-900"}`}
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${primary ? "bg-white/20" : "bg-rose-50 text-rose-600"}`}>
                    <Phone className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-2xl font-extrabold leading-none">{n.number}</span>
                    <span className={`mt-0.5 block truncate text-xs ${primary ? "text-red-50" : "text-slate-600"}`}>{n.label}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>

        {section("Police stations", Shield, help?.police, "No police station mapped within 3 km.", "Police station")}
        {section("Hospitals", Hospital, help?.hospitals, "No hospital mapped within 3 km.", "Hospital")}
        {help && help.pharmacies.length > 0 && section("24-hour pharmacies", Pill, help.pharmacies, "", "Pharmacy")}
        {help && help.fuel.length > 0 && section("Petrol pumps (safe places to wait)", Fuel, help.fuel, "", "Petrol pump")}

        <DeviceSettings />

        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Safety tips</h2>
          <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
            {TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
        <p className="text-xs text-slate-500">Places come from OpenStreetMap and may be incomplete. In an emergency always call 112.</p>
      </div>
    </main>
  );
}
