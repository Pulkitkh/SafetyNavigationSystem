import { AbsoluteFill, interpolate } from "remotion";
import { AppBg } from "../components/AppBg";
import { Phone } from "../components/Phone";
import { useT } from "../components/Scene";
import { C, EASE, FONT } from "../theme";
import { cue } from "../timeline";

const START = cue("live", "l12", 0);
const FOLLOW = cue("live", "l12", 1);
const PW = 450;

function Label({ text, sub, x, p }: { text: string; sub: string; x: number; p: number }) {
  return (
    <div style={{ position: "absolute", left: x, width: PW, top: 1590, textAlign: "center", fontFamily: FONT, opacity: p, transform: `translateY(${(1 - p) * 20}px)` }}>
      <div style={{ color: C.ink, fontSize: 44, fontWeight: 800 }}>{text}</div>
      <div style={{ color: C.ink3, fontSize: 30, fontWeight: 600, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

export function Live() {
  const t = useT();
  const a = interpolate(t, [START - 14, START + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const b = interpolate(t, [FOLLOW - 6, FOLLOW + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const arc = interpolate(t, [FOLLOW + 6, FOLLOW + 26], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const travel = ((t - FOLLOW) % 36) / 36;
  const live = 0.6 + 0.4 * Math.sin(t / 5);
  // The link between the phones: an arc over the gap.
  const P0 = [275, 640];
  const P1 = [805, 640];
  const CP = [540, 470];
  const q = (u: number) => [(1 - u) ** 2 * P0[0] + 2 * (1 - u) * u * CP[0] + u * u * P1[0], (1 - u) ** 2 * P0[1] + 2 * (1 - u) * u * CP[1] + u * u * P1[1]];
  const dot = q(travel);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AppBg seed={23} />
      <Phone src="screens/journey.png" width={PW} style={{ left: 50, top: 640 + (1 - a) * 80, opacity: a, transform: `rotate(${-3 * a}deg)` }} />
      <Phone src="screens/maa-tracking.png" width={PW} style={{ left: 580, top: 640 + (1 - b) * 80, opacity: b, transform: `rotate(${3 * b}deg)` }} />
      <svg width={1080} height={1920} style={{ position: "absolute", inset: 0 }}>
        <path d={`M${P0[0]} ${P0[1]} Q${CP[0]} ${CP[1]} ${P1[0]} ${P1[1]}`} pathLength={1} stroke={C.goodHi} strokeWidth={6} strokeDasharray={arc >= 1 ? "0.02 0.02" : `${arc} 2`} fill="none" opacity={0.9} />
        {arc >= 1 && <circle cx={dot[0]} cy={dot[1]} r={12} fill={C.goodHi} style={{ filter: `drop-shadow(0 0 10px ${C.goodHi})` }} />}
      </svg>
      <div style={{ position: "absolute", left: 540 - 110, top: 425, width: 220, height: 70, borderRadius: 35, background: "#0b2a1f", boxShadow: `0 0 0 2px ${C.good}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 14, fontFamily: FONT, fontWeight: 800, fontSize: 34, letterSpacing: 4, color: C.goodHi, opacity: arc }}>
        <span style={{ width: 18, height: 18, borderRadius: 9, background: C.goodHi, opacity: live, boxShadow: `0 0 ${14 * live}px ${C.goodHi}` }} />
        LIVE
      </div>
      <Label text="Priya" sub="walking home" x={50} p={a} />
      <Label text="Maa" sub="following live" x={580} p={b} />
    </AbsoluteFill>
  );
}
