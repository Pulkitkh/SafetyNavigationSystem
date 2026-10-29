"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/client/api";
import { batteryLevel, useGeolocation, useSession } from "@/lib/client/hooks";
import { haversine } from "@/lib/geo";

const EVERY_MS = 60_000;
const MOVED_M = 40;

/**
 * Always-on sharing while SafeNav is open: sends the user's position about once a
 * minute, sooner after moving. In the Android app the native safety service also
 * sends it with the screen locked and the app closed.
 */
export function LiveShare() {
  const { me } = useSession();
  const on = !!me?.shareLive;
  const geo = useGeolocation(on);
  const last = useRef<{ at: number; lat: number; lng: number } | null>(null);

  useEffect(() => {
    const f = geo.fix;
    if (!on || !f || document.visibilityState !== "visible") return;
    const prev = last.current;
    const moved = prev ? haversine([prev.lng, prev.lat], [f.lng, f.lat]) : Infinity;
    if (prev && Date.now() - prev.at < EVERY_MS && moved < MOVED_M) return;
    last.current = { at: Date.now(), lat: f.lat, lng: f.lng };
    void (async () => {
      await api("/api/me/location", { method: "POST", json: { lat: f.lat, lng: f.lng, accuracy: Math.min(f.accuracy, 10_000), battery: await batteryLevel(), at: f.at } }).catch(() => {});
    })();
  }, [on, geo.fix]);

  return null;
}
