import { interpolate } from "remotion";
import { C, EASE_IN_OUT } from "../theme";

/** A highlighter loop drawn around a box (screen coordinates), as if by hand. */
export function Marker({ box, t, color = C.brandHi, dur = 16, width = 2.6 }: { box: [number, number, number, number]; t: number; color?: string; dur?: number; width?: number }) {
  const [x1, y1, x2, y2] = box;
  const p = interpolate(t, [0, dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT });
  if (t < 0) return null;
  const pad = 5;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rx = (x2 - x1) / 2 + pad + 4;
  const ry = (y2 - y1) / 2 + pad;
  // A loop that overshoots its start a little, like a pen stroke.
  const d = `M ${cx - rx * 0.2} ${cy - ry} C ${cx + rx * 1.02} ${cy - ry * 1.08}, ${cx + rx * 1.04} ${cy + ry * 1.05}, ${cx} ${cy + ry} C ${cx - rx * 1.05} ${cy + ry * 0.98}, ${cx - rx * 1.03} ${cy - ry * 1.04}, ${cx + rx * 0.15} ${cy - ry * 1.12}`;
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={390} height={844}>
      <path d={d} pathLength={1} strokeDasharray={`${p} 2`} stroke={color} strokeWidth={width} strokeLinecap="round" fill="none" />
    </svg>
  );
}
