"use client";

import { BatteryMedium, Clock, Navigation, Phone, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Map, { type MapMarker } from "@/components/Map";
import { formatAgo } from "@/lib/client/api";
import type { LngLat } from "@/lib/geo";
import { VEHICLE_LABELS, type VehicleType } from "@/lib/phone";

interface Shared {
  name: string;
  phone: string | null;
  mode: "walk" | "ride";
  status: "active" | "alert" | "sos" | "ended";
  overdue: boolean;
  alertReason: string | null;
  destLabel: string;
  dest: LngLat | null;
  route: LngLat[];
  expectedArrival: string;
  vehicleType: VehicleType | null;
  vehiclePlate: string | null;
  vehicleNote: string | null;
  last: { lat: number; lng: number; accuracy: number | null; at: string; battery: number | null } | null;
  trail: LngLat[];
  endedAt: string | null;
}

const POLL_MS = 5000;

export default function SharedTripPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Shared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/share/${encodeURIComponent(token)}`, { cache: "no-store" });
        const body = await res.json();
        if (stop) return;
        if (!res.ok) {
          setError(body.error ?? "This link is not available");
          return;
        }
        setData(body);
        setError(null);
        setStale(false);
      } catch {
        if (!stop) setStale(true);
      }
    };
    void load();
    // Opened from an alert: let the person in danger know their contact has seen it.
    const g = new URLSearchParams(window.location.search).get("g");
    if (g) {
      void fetch(`/api/share/${encodeURIComponent(token)}/seen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ g }) }).catch(() => {});
    }
    const id = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      clearInterval(id);
      clearInterval(tick);
    };
  }, [token]);

  const markers: MapMarker[] = useMemo(() => (data?.dest ? [{ id: "dest", point: data.dest, kind: "dest", label: data.destLabel }] : []), [data?.dest, data?.destLabel]);
  const user = data?.last ? { point: [data.last.lng, data.last.lat] as LngLat, accuracy: data.last.accuracy ?? undefined } : null;
  const lastSeenMs = data?.last ? now - new Date(data.last.at).getTime() : null;

  if (error && !data) {
    return (
      <main id="main" className="pt-safe mx-auto max-w-md px-4">
        <div className="card mt-6 p-6">
          <h1 className="text-xl font-extrabold text-ink">Live location unavailable</h1>
          <p className="mt-2 text-ink-2">{error}</p>
          <p className="mt-4 text-sm text-ink-2">If you think someone is in danger, call them or dial 112.</p>
          <a href="tel:112" className="btn btn-sos mt-4 w-full">
            <Phone className="h-5 w-5" aria-hidden />
            Call 112
          </a>
        </div>
      </main>
    );
  }

  const first = data?.name.split(" ")[0] ?? "";
  const banner = !data
    ? null
    : data.status === "sos"
      ? { cls: "bg-sos text-white", icon: ShieldAlert, title: `SOS: ${data.name} needs help`, text: data.alertReason && data.alertReason !== "SOS" ? `Reason: ${data.alertReason}. Call them now.` : "Call them now. If they don't answer, call 112 with this location." }
      : data.status === "alert"
        ? { cls: "bg-caution-soft text-ink", icon: TriangleAlert, title: "Check-in pending", text: data.alertReason ?? "Waiting for a response" }
        : data.status === "ended"
          ? { cls: "bg-good text-white dark:text-[#062217]", icon: ShieldCheck, title: data.alertReason === "Marked safe" ? `${first} is safe` : `${first} ended the trip`, text: data.alertReason && data.alertReason !== "Marked safe" ? data.alertReason : "No more updates will be shared." }
          : data.overdue
            ? { cls: "bg-caution-soft text-ink", icon: Clock, title: `${first} is later than expected`, text: "Consider giving them a call." }
            : { cls: "hero-gradient", icon: Navigation, title: `${first} is ${data.mode === "ride" ? "on a ride" : "walking"}`, text: `To ${data.destLabel}` };

  return (
    <main id="main" className="flex h-dvh flex-col bg-canvas">
      {banner && (
        <div className={`flex items-start gap-3 px-4 pb-3.5 pt-[max(0.875rem,env(safe-area-inset-top))] ${banner.cls}`} role="status" aria-live="polite">
          <banner.icon className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="text-lg font-extrabold leading-tight">{banner.title}</p>
            <p className="text-sm opacity-90">{banner.text}</p>
          </div>
        </div>
      )}
      <div className="relative flex-1">
        <Map
          routes={data?.route.length ? [{ id: "route", coordinates: data.route }] : []}
          selectedId="route"
          user={user}
          trail={data?.trail}
          markers={markers}
          fitKey={data ? "loaded" : "loading"}
        />
      </div>
      {data && (
        <section className="sheet -mt-5 relative z-10 space-y-3 bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" aria-hidden />
              Updated{" "}
              <strong className={lastSeenMs != null && lastSeenMs > 120_000 ? "text-caution" : "text-ink"}>{data.last ? formatAgo(data.last.at, now) : "waiting for location"}</strong>
              {stale && " (reconnecting…)"}
            </span>
            {data.last?.battery != null && (
              <span className="flex items-center gap-1.5">
                <BatteryMedium className="h-4 w-4" aria-hidden />
                <strong className={data.last.battery < 0.15 ? "text-danger" : "text-ink"}>{Math.round(data.last.battery * 100)}%</strong>
              </span>
            )}
            {data.status !== "ended" && data.dest && (
              <span>
                Expected by <strong className="text-ink">{new Date(data.expectedArrival).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</strong>
              </span>
            )}
          </div>
          {(data.vehiclePlate || data.vehicleType) && (
            <p className="card-inset p-3 text-sm text-ink">
              <strong>{data.vehicleType ? VEHICLE_LABELS[data.vehicleType] : "Vehicle"}</strong>
              {data.vehiclePlate && <span className="ml-2 font-mono font-bold">{data.vehiclePlate}</span>}
              {data.vehicleNote && <span className="block text-ink-2">{data.vehicleNote}</span>}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {data.phone ? (
              <a href={`tel:${data.phone}`} className="btn btn-primary">
                <Phone className="h-5 w-5" aria-hidden />
                Call {first}
              </a>
            ) : (
              <span className="btn bg-surface-2 text-sm font-semibold text-ink-3">No phone shared</span>
            )}
            <a href="tel:112" className="btn btn-sos">
              <Phone className="h-5 w-5" aria-hidden />
              Call 112
            </a>
          </div>
          {data.last && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${data.last.lat},${data.last.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost w-full"
            >
              <Navigation className="h-5 w-5" aria-hidden />
              Directions to their location
            </a>
          )}
        </section>
      )}
    </main>
  );
}
