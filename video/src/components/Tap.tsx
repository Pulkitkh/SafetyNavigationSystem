import { interpolate } from "remotion";

/** A fingertip press: a soft disc that lands, then a ripple. Drawn in screen coordinates. */
export function Tap({ x, y, t, hold = 6 }: { x: number; y: number; t: number; hold?: number }) {
  if (t < -8 || t > hold + 26) return null;
  const land = interpolate(t, [-8, 0], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const lift = interpolate(t, [hold, hold + 8], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rip = interpolate(t, [0, 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <>
      <div style={{ position: "absolute", left: x - 40, top: y - 40, width: 80, height: 80, borderRadius: 40, border: "3px solid rgba(255,255,255,0.9)", opacity: t >= 0 ? 1 - rip : 0, transform: `scale(${0.5 + rip * 1.4})` }} />
      <div style={{ position: "absolute", left: x - 22, top: y - 22, width: 44, height: 44, borderRadius: 22, background: "rgba(255,255,255,0.55)", boxShadow: "0 0 0 2px rgba(255,255,255,0.7)", opacity: land * lift, transform: `scale(${1.3 - 0.3 * land})` }} />
    </>
  );
}
