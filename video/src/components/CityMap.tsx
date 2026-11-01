import type { ReactNode } from "react";
import { C } from "../theme";
import { rand } from "../util";

export type Pt = [number, number];

// A small stylised neighbourhood (frame coordinates). One lit main road, a grid of side streets and one dark lane.
const XS = [120, 330, 540, 750, 960];
const YS = [560, 760, 960, 1160, 1360, 1560];
export const MAIN: Pt[] = [
  [120, 1560],
  [120, 1160],
  [960, 1160],
  [960, 560],
];
export const ALLEY: Pt[] = [
  [330, 1360],
  [750, 760],
];
export const FASTEST: Pt[] = [[120, 1560], [330, 1560], [330, 1360], ...ALLEY, [750, 560], [960, 560]];
export const START: Pt = [120, 1560];
export const HOME: Pt = [960, 560];

const len = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export function pathD(pts: Pt[]) {
  return pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
}
/** The point a fraction `p` of the way along a polyline. */
export function pointAt(pts: Pt[], p: number): Pt {
  const total = pts.slice(1).reduce((s, q, i) => s + len(pts[i], q), 0);
  let d = Math.max(0, Math.min(1, p)) * total;
  for (let i = 1; i < pts.length; i++) {
    const l = len(pts[i - 1], pts[i]);
    if (d <= l) return [pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * d) / l, pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * d) / l];
    d -= l;
  }
  return pts[pts.length - 1];
}

// Street lights: dense along the main road, sparse on side streets, none in the lane.
const LAMPS: Pt[] = (() => {
  const out: Pt[] = [];
  for (let i = 1; i < MAIN.length; i++) {
    const l = len(MAIN[i - 1], MAIN[i]);
    for (let d = 40; d < l; d += 64) {
      const p = pointAt([MAIN[i - 1], MAIN[i]], d / l);
      const side = i === 2 ? [0, -26] : [-26, 0];
      out.push([p[0] + side[0], p[1] + side[1]]);
    }
  }
  YS.forEach((y, r) =>
    XS.forEach((x, c) => {
      if (rand(r * 9 + c * 3 + 1) > 0.55) out.push([x + 100, y - 14]);
    }),
  );
  return out.filter(([x, y]) => !(x > 300 && x < 780 && y > 740 && y < 1380 && Math.abs((y - 1360) / (760 - 1360) - (x - 330) / (750 - 330)) < 0.25));
})();

/** Night map: blocks, streets, street lights and pins. `children` draw on top in the same coordinates. */
export function CityMap({ t, children, dim = 0 }: { t: number; children?: ReactNode; dim?: number }) {
  return (
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
      <defs>
        <radialGradient id="lampG">
          <stop offset="0" stopColor="rgba(255,207,122,0.55)" />
          <stop offset="1" stopColor="rgba(255,207,122,0)" />
        </radialGradient>
        <radialGradient id="darkG">
          <stop offset="0" stopColor="rgba(0,0,0,0.75)" />
          <stop offset="1" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={1080} height={1920} fill="#0e0d18" />
      {/* Blocks */}
      {YS.slice(0, -1).map((y, r) =>
        XS.slice(0, -1).map((x, c) => <rect key={`${r}-${c}`} x={x + 16} y={y + 16} width={XS[c + 1] - x - 32} height={YS[r + 1] - y - 32} rx={14} fill="#17162a" />),
      )}
      {/* Side streets */}
      {XS.map((x) => (
        <line key={`x${x}`} x1={x} y1={460} x2={x} y2={1660} stroke="#262439" strokeWidth={16} strokeLinecap="round" />
      ))}
      {YS.map((y) => (
        <line key={`y${y}`} x1={40} y1={y} x2={1040} y2={y} stroke="#262439" strokeWidth={16} strokeLinecap="round" />
      ))}
      {/* The lane: a shortcut between blocks, unlit */}
      <path d={pathD(ALLEY)} stroke="#211f31" strokeWidth={12} strokeLinecap="round" fill="none" />
      <ellipse cx={540} cy={1060} rx={300} ry={330} fill="url(#darkG)" />
      {/* Main road */}
      <path d={pathD(MAIN)} stroke="#34304f" strokeWidth={30} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {LAMPS.map(([x, y], i) => {
        const tw = 0.85 + 0.15 * Math.sin(t / 9 + i);
        return (
          <g key={i} opacity={tw * (1 - dim * 0.6)}>
            <circle cx={x} cy={y} r={34} fill="url(#lampG)" />
            <circle cx={x} cy={y} r={4.5} fill={C.lamp} />
          </g>
        );
      })}
      {/* Pins */}
      <g transform={`translate(${HOME[0]} ${HOME[1]})`}>
        <circle r={40} fill="rgba(124,92,255,0.25)" />
        <circle r={24} fill={C.brand} stroke="#fff" strokeWidth={5} />
        <path d="M-9 4 L0 -6 L9 4 L9 11 L-9 11 Z" fill="#fff" />
      </g>
      {children}
    </svg>
  );
}

/** A route line that draws itself; `p` from 0 to 1. */
export function Route({ pts, p, color, width = 14, glow }: { pts: Pt[]; p: number; color: string; width?: number; glow?: string }) {
  return (
    <>
      {glow && <path d={pathD(pts)} pathLength={1} strokeDasharray={`${p} 2`} stroke={glow} strokeWidth={width * 2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.35} />}
      <path d={pathD(pts)} pathLength={1} strokeDasharray={`${p} 2`} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  );
}

/** Priya's position: a pulsing dot. */
export function Me({ at, t, color = "#5aa2ff" }: { at: Pt; t: number; color?: string }) {
  const pulse = (t % 40) / 40;
  return (
    <g transform={`translate(${at[0]} ${at[1]})`}>
      <circle r={22 + pulse * 40} fill={color} opacity={0.35 * (1 - pulse)} />
      <circle r={20} fill={color} stroke="#fff" strokeWidth={6} />
    </g>
  );
}
