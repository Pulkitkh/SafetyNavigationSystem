"use client";

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
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-bold text-slate-900">Live location unavailable</h1>
        <p className="mt-2 text-slate-600">{error}</p>
        <p className="mt-4 text-sm text-slate-500">If you think someone is in danger, call them or dial 112.</p>
      </main>
    );
  }

  const banner = !data
    ? null
    : data.status === "sos"
      ? { cls: "bg-red-600 text-white", text: `SOS — ${data.name} needs help${data.alertReason && data.alertReason !== "SOS" ? ` (${data.alertReason})` : ""}` }
      : data.status === "alert"
        ? { cls: "bg-amber-500 text-slate-900", text: `Check-in pending: ${data.alertReason ?? "waiting for a response"}` }
        : data.status === "ended"
          ? { cls: "bg-green-600 text-white", text: `${data.name} ended the trip${data.alertReason ? ` (${data.alertReason})` : ""}` }
          : data.overdue
            ? { cls: "bg-amber-500 text-slate-900", text: `${data.name} is later than expected` }
            : { cls: "bg-brand-600 text-white", text: `${data.name} is ${data.mode === "ride" ? "on a ride" : "walking"} to ${data.destLabel}` };

  return (
    <main className="flex h-dvh flex-col">
      {banner && (
        <div className={`px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] font-semibold ${banner.cls}`} role="status" aria-live="polite">
          {banner.text}
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
        <section className="space-y-3 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          <div className="flex flex-wrap justify-between gap-2 text-sm text-slate-700">
            <span>
              Last update:{" "}
              <strong className={lastSeenMs != null && lastSeenMs > 120_000 ? "text-amber-700" : ""}>
                {data.last ? formatAgo(data.last.at, now) : "waiting for location"}
              </strong>
              {stale && " (reconnecting…)"}
            </span>
            {data.last?.battery != null && <span>Battery {Math.round(data.last.battery * 100)}%</span>}
            {data.status !== "ended" && data.dest && (
              <span>Expected by {new Date(data.expectedArrival).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>
            )}
          </div>
          {(data.vehiclePlate || data.vehicleType) && (
            <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-800">
              <strong>{data.vehicleType ? VEHICLE_LABELS[data.vehicleType] : "Vehicle"}</strong>
              {data.vehiclePlate && <span className="ml-2 font-mono">{data.vehiclePlate}</span>}
              {data.vehicleNote && <span className="block text-slate-600">{data.vehicleNote}</span>}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {data.phone ? (
              <a href={`tel:${data.phone}`} className="rounded-xl bg-brand-600 py-3 text-center font-semibold text-white">
                Call {data.name.split(" ")[0]}
              </a>
            ) : (
              <span className="rounded-xl bg-slate-100 py-3 text-center text-sm text-slate-500">No phone shared</span>
            )}
            <a href="tel:112" className="rounded-xl bg-red-600 py-3 text-center font-semibold text-white">
              Call 112
            </a>
          </div>
          {data.last && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${data.last.lat},${data.last.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-sm font-medium text-brand-600"
            >
              Get directions to their location
            </a>
          )}
        </section>
      )}
    </main>
  );
}
