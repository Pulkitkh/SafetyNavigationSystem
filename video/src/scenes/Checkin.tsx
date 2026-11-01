import { AbsoluteFill, interpolate } from "remotion";
import { CityMap, MAIN, Me, pointAt, Route, type Pt } from "../components/CityMap";
import { Phone } from "../components/Phone";
import { useT } from "../components/Scene";
import { C, EASE, EASE_IN_OUT, FONT, POP } from "../theme";
import { cue } from "../timeline";

const STRAY = cue("checkin", "l13", 0) + 38;
const CHECK = cue("checkin", "l13", 1);
const JUNCTION: Pt = [540, 1160];
const OFF: Pt = [540, 1330];

export function Checkin() {
  const t = useT();
  const along = interpolate(t, [-8, 30], [0.3, 0.4457], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT });
  const off = interpolate(t, [STRAY, STRAY + 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT });
  const at: Pt = off > 0 ? [JUNCTION[0] + (OFF[0] - JUNCTION[0]) * off, JUNCTION[1] + (OFF[1] - JUNCTION[1]) * off] : pointAt(MAIN, along);
  const warn = interpolate(t, [STRAY + 18, STRAY + 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: POP });
  const rise = interpolate(t, [CHECK - 8, CHECK + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const zoom = interpolate(t, [0, 140], [1.18, 1.3], { easing: EASE_IN_OUT });
  return (
    <AbsoluteFill style={{ background: "#0e0d18", overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "540px 1200px", filter: `blur(${rise * 6}px) brightness(${1 - rise * 0.35})` }}>
        <CityMap t={t}>
          <Route pts={MAIN} p={1} color={C.goodHi} width={16} glow={C.goodHi} />
          {off > 0 && <path d={`M${JUNCTION[0]} ${JUNCTION[1]} L${at[0]} ${at[1]}`} stroke={C.caution} strokeWidth={10} strokeDasharray="14 14" strokeLinecap="round" />}
          {warn > 0 && <circle cx={at[0]} cy={at[1]} r={60 + 10 * Math.sin(t / 4)} fill="none" stroke={C.caution} strokeWidth={6} opacity={warn} />}
          <Me at={at} t={t} />
        </CityMap>
        <div style={{ position: "absolute", left: OFF[0] + 80, top: OFF[1] - 34, padding: "14px 24px", borderRadius: 999, background: "#3a2a08", color: C.caution, fontFamily: FONT, fontWeight: 800, fontSize: 34, opacity: warn, transform: `scale(${0.7 + 0.3 * warn})`, transformOrigin: "0 50%" }}>
          Off the route
        </div>
      </AbsoluteFill>
      <Phone src="screens/checkin.png" width={600} zoom={1.2} focus={[195, 640]} style={{ left: 240, top: 560 + (1 - rise) * 1300 }} glow="rgba(225,29,72,0.25)" />
    </AbsoluteFill>
  );
}
