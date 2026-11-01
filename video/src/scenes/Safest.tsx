import { AbsoluteFill, Img, interpolate, staticFile } from "remotion";
import { AppBg } from "../components/AppBg";
import { Marker } from "../components/Marker";
import { Phone } from "../components/Phone";
import { useT } from "../components/Scene";
import { EASE, EASE_IN_OUT } from "../theme";
import { cue } from "../timeline";

const FIND = cue("safest", "l11", 0);
const LONGER = cue("safest", "l11", 1);
const WHY = cue("safest", "l11", 2);

export function Safest() {
  const t = useT();
  const inP = interpolate(t, [-8, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const kz = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT } as const;
  const zoom = interpolate(t, [FIND, FIND + 30, WHY - 4, WHY + 22], [1, 1.95, 1.95, 1.75], kz);
  const fx = interpolate(t, [FIND, FIND + 30], [195, 190], kz);
  const fy = interpolate(t, [FIND, FIND + 30, LONGER - 4, LONGER + 16, WHY - 4, WHY + 22], [420, 400, 400, 430, 430, 595], kz);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AppBg tint="rgba(15,122,85,0.22)" seed={17} />
      <Phone width={640} zoom={zoom} focus={[fx, fy]} style={{ left: 220, top: 540 + (1 - inP) * 60, opacity: inP }} glow="rgba(74,222,155,0.25)">
        <Img src={staticFile("screens/route-card.png")} style={{ position: "absolute", width: 390, height: 844 }} />
        <Marker box={[25, 370, 82, 428]} t={t - FIND - 26} color="#0f7a55" />
        <Marker box={[107, 400, 278, 419]} t={t - FIND - 40} />
        <Marker box={[106, 451, 300, 488]} t={t - LONGER - 14} />
        <Marker box={[18, 506, 172, 558]} t={t - WHY - 18} color="#0f7a55" dur={12} />
        <Marker box={[18, 632, 172, 684]} t={t - WHY - 28} color="#0f7a55" dur={12} />
        <Marker box={[188, 632, 350, 684]} t={t - WHY - 38} color="#0f7a55" dur={12} />
      </Phone>
    </AbsoluteFill>
  );
}
