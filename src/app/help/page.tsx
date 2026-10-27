"use client";

import { useEffect, useState } from "react";
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

  const section = (title: string, places: Place[] | undefined, empty: string) => (
    <div>
      <h2 className="mb-2 font-semibold text-slate-900">{title}</h2>
      {!places ? (
        <p className="text-sm text-slate-500">{error ?? (geo.error || "Finding places near you…")}</p>
      ) : places.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {places.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl bg-white p-3 text-sm shadow-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">{p.name ?? title.replace(/s$/, "")}</p>
                <p className="text-slate-500">
                  {formatDistance(p.distance)} away{p.openingHours ? ` · ${p.openingHours}` : ""}
                </p>
              </div>
              {p.phone && (
                <a href={`tel:${p.phone.split(";")[0].replace(/\s/g, "")}`} className="rounded-lg bg-slate-100 px-3 py-1.5 font-medium text-slate-800">
                  Call
                </a>
              )}
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${p.point[1]},${p.point[0]}&travelmode=walking`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white"
              >
                Go
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <main className="mx-auto max-w-lg pb-nav">
      <PageHeader title="Help" subtitle="Emergency numbers work even without balance or mobile data." />
      <div className="space-y-5 px-4">
        <ul className="grid grid-cols-2 gap-2">
          {EMERGENCY_NUMBERS.map((n) => (
            <li key={n.number} className={"primary" in n && n.primary ? "col-span-2" : ""}>
              <a
                href={`tel:${n.number}`}
                className={`block rounded-2xl p-3 ${"primary" in n && n.primary ? "bg-red-600 text-white" : "bg-white text-slate-900 shadow-sm"}`}
              >
                <span className="block text-2xl font-bold">{n.number}</span>
                <span className={`text-sm ${"primary" in n && n.primary ? "text-red-50" : "text-slate-600"}`}>{n.label}</span>
              </a>
            </li>
          ))}
        </ul>

        {section("Police stations", help?.police, "No police station mapped within 3 km.")}
        {section("Hospitals", help?.hospitals, "No hospital mapped within 3 km.")}
        {help && help.pharmacies.length > 0 && section("24-hour pharmacies", help.pharmacies, "")}

        <div>
          <h2 className="mb-2 font-semibold text-slate-900">Safety tips</h2>
          <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
            {TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-slate-500">Places come from OpenStreetMap and may be incomplete. In an emergency always call 112.</p>
      </div>
    </main>
  );
}
