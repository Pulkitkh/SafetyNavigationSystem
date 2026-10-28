"use client";

import { useEffect, useRef } from "react";

/** Peaks of this many m/s² above gravity count as a shake (walking stays well under 10). */
const PEAK_MS2 = 18;
const PEAKS_NEEDED = 4;
const WINDOW_MS = 2000;

/** Pure detector, exported for tests: feed it acceleration magnitudes, it says when a shake completes. */
export function createShakeDetector(peak = PEAK_MS2, needed = PEAKS_NEEDED, windowMs = WINDOW_MS) {
  let peaks: number[] = [];
  let above = false;
  return (magnitude: number, at: number): boolean => {
    const strong = Math.abs(magnitude - 9.81) >= peak;
    if (strong && !above) {
      peaks = [...peaks.filter((t) => at - t <= windowMs), at];
      if (peaks.length >= needed) {
        peaks = [];
        above = strong;
        return true;
      }
    }
    above = strong;
    return false;
  };
}

/** iOS asks for motion permission, and only from inside a tap. */
export async function requestMotionPermission(): Promise<boolean> {
  const DME = (typeof window !== "undefined" ? window.DeviceMotionEvent : undefined) as
    | (typeof DeviceMotionEvent & { requestPermission?: () => Promise<"granted" | "denied"> })
    | undefined;
  if (!DME) return false;
  if (typeof DME.requestPermission !== "function") return true;
  try {
    return (await DME.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export function useShake(enabled: boolean, onShake: () => void) {
  const cb = useRef(onShake);
  cb.current = onShake;
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !("DeviceMotionEvent" in window)) return;
    const detect = createShakeDetector();
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (a?.x == null || a.y == null || a.z == null) return;
      if (detect(Math.hypot(a.x, a.y, a.z), e.timeStamp || performance.now())) cb.current();
    };
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [enabled]);
}
