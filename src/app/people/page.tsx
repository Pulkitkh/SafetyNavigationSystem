"use client";

import { BatteryLow, ChevronRight, Eye, EyeOff, HeartHandshake, MapPin, Phone, Radio, ShieldAlert, Users } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { ContactsTabs } from "@/components/ContactsTabs";
import Map, { type MapMarker } from "@/components/Map";
import { AlertsCard } from "@/components/AlertsCard";
import { PageHeader } from "@/components/Nav";
import { initials } from "@/components/Sos";
import { Badge, Callout, EmptyState } from "@/components/ui";
import { useSession } from "@/lib/client/hooks";
import { locationLine, RESPONSE_TEXT, STATUS, usePeople } from "@/lib/client/people";

export default function PeoplePage() {
  const { me, loading } = useSession();
  const { people, error } = usePeople(10_000);
  const sosCount = people?.filter((p) => p.status === "sos").length ?? 0;

  const markers: MapMarker[] = useMemo(
    () =>
      (people ?? [])
        .filter((p) => p.location)
        .map((p) => ({ id: p.userId, point: [p.location!.lng, p.location!.lat], kind: p.status === "sos" ? "sos" : "person", label: `${p.name}: ${locationLine(p)}` })),
    [people],
  );

  if (!loading && !me) {
    return (
      <main id="main" className="mx-auto max-w-lg pb-nav">
        <PageHeader title="People I protect" subtitle="Everyone who added you as their trusted contact." icon={<HeartHandshake />} />
        <ContactsTabs />
        <div className="card mx-4">
          <EmptyState
            icon={HeartHandshake}
            title="Sign in to see them"
            text="When someone adds you as a trusted contact, you can follow their journeys, see their live location if they share it, and get their SOS here."
            action={
              <Link href="/login?next=/people" className="btn btn-primary w-full">
                Sign in
              </Link>
            }
          />
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="mx-auto max-w-lg pb-nav">
      <PageHeader title="People I protect" subtitle="Everyone who added you as their trusted contact." icon={<HeartHandshake />} />
      <ContactsTabs sosCount={sosCount} />
      <div className="space-y-4 px-4">
        {error && <Callout tone="danger">{error}</Callout>}
        <AlertsCard compact />
        {!people ? (
          <div className="space-y-3" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="card h-28 animate-pulse" />
            ))}
          </div>
        ) : people.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={Users}
              title="Nobody yet"
              text="When someone adds you on SafeNav, they send you an invite link. Open it while signed in and tap Add to my People. Then they appear here."
            />
          </div>
        ) : (
          <>
            {markers.length > 0 && (
              <div className="card relative h-56 overflow-hidden p-0">
                <Map markers={markers} fitKey={markers.map((m) => m.id).join(",")} />
              </div>
            )}
            <ul className="space-y-3">
              {people.map((p, i) => {
                const s = STATUS[p.status];
                const lowBattery = p.location?.battery != null && p.location.battery < 0.15;
                return (
                  <li key={p.userId} className={`card rise rise-${Math.min(i + 1, 4)} overflow-hidden ${p.status === "sos" ? "ring-2 ring-sos" : ""}`}>
                    <Link href={`/people/${p.userId}`} className="tap flex items-center gap-3 p-4">
                      <span
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-extrabold ${p.status === "sos" ? "bg-sos text-white" : "bg-brand-soft text-brand-soft-ink"}`}
                        aria-hidden
                      >
                        {initials(p.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-extrabold text-ink">
                          <span className="break-words">{p.name}</span>
                          <Badge tone={s.tone} icon={p.status === "sos" ? ShieldAlert : p.status === "journey" ? Radio : p.sharing ? Eye : EyeOff}>
                            {s.text}
                          </Badge>
                        </p>
                        <p className="mt-0.5 flex items-center gap-1 text-sm text-ink-2">
                          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          {locationLine(p)}
                        </p>
                        {p.trip && p.status !== "sos" && (
                          <p className="text-sm text-ink-2">
                            {p.trip.mode === "ride" ? "Riding" : "Walking"} to {p.trip.destLabel}
                          </p>
                        )}
                        {p.myResponse && <p className="text-sm font-bold text-good">You: {RESPONSE_TEXT[p.myResponse]}</p>}
                        {lowBattery && (
                          <p className="flex items-center gap-1 text-sm font-bold text-danger">
                            <BatteryLow className="h-4 w-4" aria-hidden />
                            Phone battery low
                          </p>
                        )}
                      </div>
                      <ChevronRight className="h-5 w-5 shrink-0 text-ink-3" aria-hidden />
                    </Link>
                    {p.phone && (
                      <div className="flex border-t border-line">
                        <a href={`tel:${p.phone}`} className="tap flex min-h-12 flex-1 items-center justify-center gap-2 text-sm font-bold text-brand-ink">
                          <Phone className="h-4 w-4" aria-hidden />
                          Call {p.name.split(" ")[0]}
                        </a>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <p className="px-1 text-[13px] text-ink-3">
          You only see someone&apos;s location while they&apos;re on a journey, during an SOS, or if they turned on always-on sharing. They can stop sharing at
          any time.
        </p>
      </div>
    </main>
  );
}
