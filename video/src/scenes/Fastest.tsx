import { AbsoluteFill, interpolate } from "remotion";
import { ALLEY, CityMap, FASTEST, Me, pointAt, Route, START } from "../components/CityMap";
import { useT } from "../components/Scene";
import { C, EASE, EASE_IN_OUT, FONT, POP } from "../theme";
import { cue, tr } from "../timeline";

const DRAW = cue("fastest", "l06", 1);
const WARN = cue("fastest", "l06", 2);
const MAPS_BLUE = "#5aa2ff";

function Pill({ x, y, t, children, color, bg }: { x: number; y: number; t: number; children: React.ReactNode; color: string; bg: string }) {
  const p = interpolate(t, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: POP });
  if (t < 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `translate(-50%, -50%) scale(${0.6 + 0.4 * p})`,
        opacity: p,
        padding: "16px 26px",
        borderRadius: 999,
        background: bg,
        color,
        fontFamily: FONT,
        fontWeight: 800,
        fontSize: 36,
        whiteSpace: "nowrap",
        boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

export function Fastest() {
  const t = useT();
  const zoom = interpolate(t, [0, 190], [1.04, 1.12], { easing: EASE_IN_OUT });
  const draw = interpolate(t, [DRAW, DRAW + 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const warn = interpolate(t, [WARN, WARN + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const flick = warn * (0.55 + 0.45 * Math.abs(Math.sin((t - WARN) / 4)));
  const mid = pointAt(ALLEY, 0.5);
  return (
    <AbsoluteFill style={{ background: "#0e0d18", overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "540px 1060px" }}>
        <CityMap t={t}>
          <Route pts={FASTEST} p={draw} color={MAPS_BLUE} width={16} glow={MAPS_BLUE} />
          {warn > 0 && <path d={`M${ALLEY[0][0]} ${ALLEY[0][1]} L${ALLEY[1][0]} ${ALLEY[1][1]}`} stroke={C.sos} strokeWidth={22} strokeLinecap="round" opacity={flick} />}
          <Me at={START} t={t} color={MAPS_BLUE} />
        </CityMap>
        <Pill x={mid[0] + 170} y={mid[1] - 30} t={t - DRAW - 22} color="#0b1a33" bg={MAPS_BLUE}>
          {tr("Fastest · 18 min", "सबसे तेज़ · 18 मिनट")}
        </Pill>
        <Pill x={300} y={980} t={t - WARN} color={C.ink} bg="#3a0d1c">
          <span style={{ width: 16, height: 16, borderRadius: 8, background: C.sos }} /> {tr("No street lights", "स्ट्रीट लाइट नहीं")}
        </Pill>
        <Pill x={780} y={1300} t={t - WARN - 8} color={C.ink} bg="#3a0d1c">
          <span style={{ width: 16, height: 16, borderRadius: 8, background: C.sos }} /> {tr("Shops shut", "दुकानें बंद")}
        </Pill>
        <Pill x={330} y={1250 - 10} t={t - WARN - 16} color={C.ink} bg="#3a0d1c">
          <span style={{ width: 16, height: 16, borderRadius: 8, background: C.sos }} /> {tr("Nobody around", "आसपास कोई नहीं")}
        </Pill>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 85% 70% at 50% 58%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.7) 100%)" }} />
    </AbsoluteFill>
  );
}
