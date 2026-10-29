"use client";

import { BatteryMedium, Car, Clock, Footprints, LoaderCircle, MapPin, Navigation, Phone, ShieldAlert, Target } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import Map, { type MapMarker } from "@/components/Map";
import { PageHeader } from "@/components/Nav";
import { initials } from "@/components/Sos";
import { Badge, Callout } from "@/components/ui";
import { api, formatAgo, formatDistance } from "@/lib/client/api";
import { locationLine, respond, RESPONSE_TEXT, STATUS, type Person } from "@/lib/client/people";
import type { LngLat } from "@/lib/geo";

interface Detail {
  person: Person;
  route: LngLat[];
  trail: LngLat[];
}

const POLL_MS = 8000;

export default function PersonPage() {
  const { userId } = useParams<{ userId: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      setData(await api<Detail>(`/api/people/${encodeURIComponent(userId)}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [userId]);

  useEffect(() => {
    void load();
    const id = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    const tick = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => {
      clearInterval(id);
      clearInterval(tick);
    };
  }, [load]);

  const p = data?.person;
  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [];
    if (p?.trip?.dest) m.push({ id: "dest", point: p.trip.dest, kind: "dest", label: p.trip.destLabel });
    if (p?.location) m.push({ id: "person", point: [p.location.lng, p.location.lat], kind: p.status === "sos" ? "sos" : "person", label: `${p.name}: ${locationLine(p)}` });
    return m;
  }, [p]);

  if (error && !data) {
    return (
      <main id="main" className="mx-auto max-w-lg pb-nav">
        <PageHeader title="Not available" back="/people" />
        <div className="px-4">
          <Callout tone="danger">{error}</Callout>
        </div>
      </main>
    );
  }
  if (!p || !data) {
    return (
      <main id="main" className="flex min-h-dvh items-center justify-center" aria-busy="true">
        <LoaderCircle className="h-8 w-8 animate-spin text-brand-ink" aria-label="Loading" />
      </main>
    );
  }

  const first = p.name.split(" ")[0];
  const s = STATUS[p.status];
  const urgent = p.status === "sos" || p.status === "alert";
  const act = async (r: "on_my_way" | "calling" | "called_112") => {
    setBusy(true);
    await respond(p.userId, r).catch((err: Error) => setError(err.message));
    await load();
    setBusy(false);
  };

  return (
    <main id="main" className="flex h-dvh flex-col md:flex-row">
      <section className="relative h-[46dvh] shrink-0 md:order-2 md:h-auto md:flex-1" aria-label={`Map showing ${first}`}>
        <Map
          routes={data.route.length ? [{ id: "route", coordinates: data.route }] : []}
          selectedId="route"
          trail={data.trail}
          markers={markers}
          fitKey={`${p.location ? "l" : ""}-${p.trip?.id ?? ""}`}
        />
        {urgent && (
          <div className="absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] flex items-center gap-3 rounded-2xl bg-sos px-4 py-3 text-white shadow-float" role="alert">
            <ShieldAlert className="h-6 w-6 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="font-extrabold">{p.status === "sos" ? `${first} raised an SOS` : `${first} hasn't answered a check-in`}</p>
              {p.trip?.alertReason && p.trip.alertReason !== "SOS" && <p className="text-sm text-white/90">{p.trip.alertReason}</p>}
            </div>
          </div>
        )}
      </section>

      <section className="sheet relative z-10 -mt-6 flex-1 space-y-4 overflow-y-auto bg-canvas p-4 pb-nav md:order-1 md:mt-0 md:w-[420px] md:flex-none">
        <div className="mx-auto -mt-1.5 h-1.5 w-10 rounded-full bg-line-strong md:hidden" aria-hidden />
        <div className="flex items-center gap-3">
          <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-extrabold ${urgent ? "bg-sos text-white" : "bg-brand-soft text-brand-soft-ink"}`} aria-hidden>
            {initials(p.name)}
          </span>
          <div className="min-w-0">
            <h1 className="break-words text-xl font-extrabold text-ink">{p.name}</h1>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge tone={s.tone}>{s.text}</Badge>
              <Badge tone="neutral">You&apos;re their {p.relation.toLowerCase()}</Badge>
            </div>
          </div>
        </div>

        {p.myResponse && (
          <Callout tone="good" icon={Navigation}>
            {first} sees your answer: <b>{RESPONSE_TEXT[p.myResponse]}</b>
          </Callout>
        )}

        <div className="card divide-y divide-line overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <MapPin className="h-5 w-5 shrink-0 text-brand-ink" aria-hidden />
            <div className="min-w-0">
              <p className="font-bold text-ink">{p.location ? (Date.now() - new Date(p.location.at).getTime() < 5 * 60_000 ? "Live location" : "Last known location") : "No location shared"}</p>
              <p className="text-sm text-ink-2">
                {p.location
                  ? `Updated ${formatAgo(p.location.at)}${p.location.accuracy ? ` · within ${formatDistance(p.location.accuracy)}` : ""}`
                  : p.sharing
                    ? "Waiting for their phone to report"
                    : `${first} shares location during journeys and SOS only`}
              </p>
            </div>
          </div>
          {p.location?.battery != null && (
            <div className="flex items-center gap-3 px-4 py-3">
              <BatteryMedium className={`h-5 w-5 shrink-0 ${p.location.battery < 0.15 ? "text-danger" : "text-ink-3"}`} aria-hidden />
              <p className={`font-bold ${p.location.battery < 0.15 ? "text-danger" : "text-ink"}`}>{Math.round(p.location.battery * 100)}% battery</p>
            </div>
          )}
          {p.trip && p.trip.destLabel !== "SOS alert" && (
            <div className="flex items-center gap-3 px-4 py-3">
              {p.trip.mode === "ride" ? <Car className="h-5 w-5 shrink-0 text-ink-3" aria-hidden /> : <Footprints className="h-5 w-5 shrink-0 text-ink-3" aria-hidden />}
              <div className="min-w-0">
                <p className="font-bold text-ink">
                  {p.trip.mode === "ride" ? "Riding" : "Walking"} to {p.trip.destLabel}
                </p>
                <p className="text-sm text-ink-2">
                  Expected by {new Date(p.trip.expectedArrival).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                  {p.trip.vehicle ? ` · ${p.trip.vehicle}` : ""}
                </p>
              </div>
            </div>
          )}
          {p.trip && (
            <div className="flex items-center gap-3 px-4 py-3">
              <Clock className="h-5 w-5 shrink-0 text-ink-3" aria-hidden />
              <p className="text-sm text-ink-2">Started {formatAgo(p.trip.startedAt)}</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {p.phone && (
            <a href={`tel:${p.phone}`} onClick={() => urgent && void act("calling")} className="btn btn-primary">
              <Phone className="h-5 w-5" aria-hidden />
              Call {first}
            </a>
          )}
          {p.location && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${p.location.lat},${p.location.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`btn btn-outline ${p.phone ? "" : "col-span-2"}`}
            >
              <Target className="h-5 w-5" aria-hidden />
              Directions
            </a>
          )}
        </div>
        {urgent && (
          <div className="grid gap-2">
            <button onClick={() => void act("on_my_way")} disabled={busy || p.myResponse === "on_my_way"} className="btn btn-good text-base">
              <Navigation className="h-5 w-5" aria-hidden />
              {p.myResponse === "on_my_way" ? "They know you're on your way" : "I'm on my way"}
            </button>
            <a href="tel:112" onClick={() => void act("called_112")} className="btn btn-sos">
              <Phone className="h-5 w-5" aria-hidden />
              Call 112
            </a>
          </div>
        )}
        {error && <Callout tone="danger">{error}</Callout>}
      </section>
    </main>
  );
}
