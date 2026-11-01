import { AbsoluteFill, Img, interpolate, staticFile } from "remotion";
import { AppBg } from "../components/AppBg";
import { Phone } from "../components/Phone";
import { useT } from "../components/Scene";
import { Tap } from "../components/Tap";
import { EASE, EASE_IN_OUT, FONT } from "../theme";
import { cue } from "../timeline";

const TYPE = cue("plan", "l09", 0) + 4;
const TAP = cue("plan", "l09", 1) + 6;
const DEST = "Palasia Square";

export function Plan() {
  const t = useT();
  const rise = interpolate(t, [-6, 26], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const zoom = interpolate(t, [10, 40, TAP + 14, TAP + 40], [1, 1.32, 1.32, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT });
  const fy = interpolate(t, [10, 40, TAP - 10, TAP + 4], [560, 520, 520, 600], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT });
  const chars = Math.round(interpolate(t, [TYPE, TYPE + 30], [0, DEST.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const press = t >= TAP && t < TAP + 6 ? 0.96 : 1;
  const routes = interpolate(t, [TAP + 12, TAP + 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AppBg />
      <Phone width={640} zoom={zoom} focus={[195, fy]} style={{ left: 220, top: 540 + (1 - rise) * 900, transform: `rotate(${(1 - rise) * 6}deg)` }} glow="rgba(124,92,255,0.45)">
        <Img src={staticFile("screens/plan-form.png")} style={{ position: "absolute", width: 390, height: 844 }} />
        {/* The destination, typed in place of the captured text */}
        {t < TAP + 24 && (
          <div style={{ position: "absolute", left: 70, top: 539, width: 200, height: 25, background: "#f0eff7", fontFamily: FONT, fontSize: 16, fontWeight: 500, color: "#1c1a2e", lineHeight: "25px", paddingLeft: 4, display: "flex", alignItems: "center" }}>
            {chars ? DEST.slice(0, chars) : <span style={{ color: "#8d8aa3" }}>Where to?</span>}
            {chars < DEST.length && t >= TYPE - 4 && <span style={{ width: 1.5, height: 18, background: "#5b3fd6", marginLeft: 1, opacity: Math.floor(t / 6) % 2 ? 1 : 0.2 }} />}
          </div>
        )}
        {/* The button presses in */}
        <div style={{ position: "absolute", left: 30, top: 639, width: 330, height: 48, borderRadius: 14, background: "rgba(0,0,0,0.18)", opacity: press < 1 ? 1 : 0 }} />
        <Img src={staticFile("screens/plan-routes.png")} style={{ position: "absolute", width: 390, height: 844, opacity: routes }} />
        <Tap x={250} y={663} t={t - TAP} />
      </Phone>
    </AbsoluteFill>
  );
}
