"use client";

import { Fuel, Hospital, LifeBuoy, LoaderCircle, MapPinOff, Navigation, Phone, Pill, Shield, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/Nav";
import { Badge, Callout, SectionTitle } from "@/components/ui";
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
  source?: "overpass" | "tiles";
}

type Tab = "police" | "hospitals" | "pharmacies" | "fuel";

const TABS: { id: Tab; label: string; single: string; icon: LucideIcon }[] = [
  { id: "police", label: "Police", single: "Police station", icon: Shield },
  { id: "hospitals", label: "Hospitals", single: "Hospital", icon: Hospital },
  { id: "pharmacies", label: "Pharmacies", single: "Pharmacy", icon: Pill },
  { id: "fuel", label: "Petrol pumps", single: "Petrol pump", icon: Fuel },
];

const TIPS = [
  "Before getting into a cab or auto, check the number plate matches the app and enter it in SafeNav's ride monitoring.",
  "Sit behind the driver in a cab, keep the window controls in reach and check the child lock is off.",
  "After dark, prefer busy, lit main roads even if they take a few minutes longer.",
  "Keep your phone charged: SafeNav shares your battery level with contacts during a journey.",
  "The 112 India app and Himmat Plus (Delhi Police) also send SOS directly to police.",
  "Petrol pumps, hospitals and 24-hour pharmacies are good places to wait for help.",
];

export default function HelpPage() {
  const geo = useGeolocation();
  const [help, setHelp] = useState<Help | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const [tab, setTab] = useState<Tab>("police");

  useEffect(() => {
    if (!geo.fix || requested) return;
    setRequested(true);
    api<Help>(`/api/places/help?lat=${geo.fix.lat}&lng=${geo.fix.lng}`)
      .then(setHelp)
      .catch((err: Error) => setError(err.message));
  }, [geo.fix, requested]);

  const current = TABS.find((t) => t.id === tab)!;
  const places = help?.[tab];

  return (
    <main id="main" className="mx-auto max-w-lg pb-nav">
      <PageHeader title="Help" subtitle="Emergency numbers work even with no balance or mobile data." icon={<LifeBuoy />} />
      <div className="space-y-6 px-4">
        <section aria-label="Emergency numbers" className="space-y-2">
          {EMERGENCY_NUMBERS.filter((n) => "primary" in n && n.primary).map((n) => (
            <a key={n.number} href={`tel:${n.number}`} className="btn min-h-[4.5rem] w-full justify-start gap-4 bg-sos px-4 text-white shadow-[0_10px_24px_-10px_var(--sos)]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/20" aria-hidden>
                <Phone className="h-6 w-6" />
              </span>
              <span className="text-left">
                <span className="block text-3xl font-extrabold leading-none">{n.number}</span>
                <span className="mt-1 block text-sm font-semibold text-white/90">{n.label}</span>
              </span>
            </a>
          ))}
          <ul className="card divide-y divide-line overflow-hidden">
            {EMERGENCY_NUMBERS.filter((n) => !("primary" in n && n.primary)).map((n) => (
              <li key={n.number}>
                <a href={`tel:${n.number}`} className="tap flex min-h-16 items-center gap-4 px-4 py-2.5">
                  <span className="w-16 shrink-0 text-2xl font-extrabold tabular-nums text-ink">{n.number}</span>
                  <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-ink-2">{n.label}</span>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger" aria-hidden>
                    <Phone className="h-5 w-5" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="near-title">
          <SectionTitle id="near-title">Help near you</SectionTitle>
          <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Kind of place">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} aria-controls="near-panel" onClick={() => setTab(t.id)} className="chip shrink-0">
                <t.icon className="h-4 w-4" aria-hidden />
                {t.label}
                {help && <span className="text-ink-3">{help[t.id].length}</span>}
              </button>
            ))}
          </div>
          <div id="near-panel" role="tabpanel" className="card overflow-hidden">
            {!places ? (
              <div className="flex items-center gap-3 p-4 text-sm text-ink-2">
                {error || geo.error ? (
                  <>
                    <MapPinOff className="h-5 w-5 shrink-0 text-caution" aria-hidden />
                    {error ?? geo.error}
                  </>
                ) : (
                  <>
                    <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-brand-ink" aria-hidden />
                    Finding places near you…
                  </>
                )}
              </div>
            ) : places.length === 0 ? (
              <p className="p-4 text-sm text-ink-2">No {current.label.toLowerCase()} mapped within 3 km.</p>
            ) : (
              <ul className="divide-y divide-line">
                {places.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-bold text-ink">
                        <span className="min-w-0 break-words">{p.name ?? current.single}</span>
                        {p.openNow != null && <Badge tone={p.openNow ? "good" : "neutral"}>{p.openNow ? "Open now" : "Closed"}</Badge>}
                      </p>
                      <p className="mt-0.5 text-sm text-ink-2">
                        {formatDistance(p.distance)} away{p.openingHours ? ` · ${p.openingHours}` : ""}
                      </p>
                    </div>
                    {p.phone && (
                      <a
                        href={`tel:${p.phone.split(";")[0].replace(/\s/g, "")}`}
                        aria-label={`Call ${p.name ?? current.single}`}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink"
                      >
                        <Phone className="h-5 w-5" aria-hidden />
                      </a>
                    )}
                    <Link
                      href={`/?to=${p.point[0]},${p.point[1]}&label=${encodeURIComponent(p.name ?? current.single)}`}
                      aria-label={`Safest route to ${p.name ?? current.single}`}
                      className="btn btn-secondary btn-sm shrink-0"
                    >
                      <Navigation className="h-4 w-4" aria-hidden />
                      Route
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {help?.source === "tiles" && <p className="mt-2 px-1 text-[13px] text-ink-3">Opening hours aren&apos;t available right now, so 24-hour status isn&apos;t shown.</p>}
        </section>

        <section aria-labelledby="tips-title">
          <SectionTitle id="tips-title">Safety tips</SectionTitle>
          <ul className="card divide-y divide-line overflow-hidden">
            {TIPS.map((t, i) => (
              <li key={t} className="flex gap-3 px-4 py-3 text-[15px] leading-snug text-ink-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-extrabold text-brand-soft-ink" aria-hidden>
                  {i + 1}
                </span>
                {t}
              </li>
            ))}
          </ul>
        </section>
        <Callout tone="neutral">Places come from OpenStreetMap and may be incomplete. In an emergency always call 112.</Callout>
      </div>
    </main>
  );
}
