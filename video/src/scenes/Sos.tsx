import { AbsoluteFill, Img, interpolate, staticFile } from "remotion";
import { Marker } from "../components/Marker";
import { Cam, Phone, screenPoint } from "../components/Phone";
import { useT } from "../components/Scene";
import { Tap } from "../components/Tap";
import { C, EASE, EASE_IN_OUT, FONT } from "../theme";
import { cue } from "../timeline";

const WRONG = cue("sos", "l14", 0);
const PRESS = cue("sos", "l14", 1) + 8;
const HOLD = 34; // frames the press is held
const SENT = PRESS + HOLD;
const ALERT = cue("sos", "l14", 2);
const LOC = cue("sos", "l14", 3);
const ANSWER = LOC + 22;
const BTN: [number, number] = [195, 801];

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export function Sos() {
  const t = useT();
  // Act 1: Priya's journey screen, closing in on SOS.
  const s = interpolate(t, [WRONG, WRONG + 40], [1, 2.3], { ...clamp, easing: EASE_IN_OUT });
  const btn = screenPoint(640, 220, 540, BTN[0], BTN[1]);
  const to: [number, number] = [540, interpolate(s, [1, 2.3], [btn[1], 1200])];
  const hold = interpolate(t, [PRESS, SENT], [0, 1], clamp);
  const flash = interpolate(t, [SENT, SENT + 2, SENT + 16], [0, 0.85, 0], clamp);
  const out1 = interpolate(t, [ALERT - 14, ALERT], [1, 0], clamp);
  const tense = interpolate(t, [WRONG, PRESS], [0, 1], clamp);
  // Act 2: Maa's phone lights up.
  const in2 = interpolate(t, [ALERT - 8, ALERT + 10], [0, 1], { ...clamp, easing: EASE });
  const buzz = t > ALERT - 4 && t < LOC ? Math.sin(t * 2.2) * 2.4 * Math.max(0, 1 - ((t - ALERT) % 30) / 14) : 0;
  const wave = ((t - ALERT) % 30) / 30;
  // Act 3: her live location on Maa's screen, and Maa's answer on Priya's.
  const map = interpolate(t, [LOC - 4, LOC + 8], [0, 1], clamp);
  const split = interpolate(t, [ANSWER - 10, ANSWER + 14], [0, 1], { ...clamp, easing: EASE_IN_OUT });
  const pin = ((t - LOC) % 34) / 34;
  const maaW = 640 - 140 * split;
  const maaLeft = 220 + split * 330;
  return (
    <AbsoluteFill style={{ overflow: "hidden", fontFamily: FONT }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 80% 60% at 50% 58%, rgba(225,29,72,${0.12 + 0.3 * tense}) 0%, rgba(12,11,20,0) 72%), ${C.canvas}` }} />
      {out1 > 0 && (
        <Cam s={s} target={btn} to={to}>
        <Phone width={640} style={{ left: 220, top: 540, opacity: out1, transform: `scale(${1 - (1 - out1) * 0.1})` }} glow={`rgba(225,29,72,${0.2 + 0.4 * hold})`}>
          <Img src={staticFile("screens/journey.png")} style={{ position: "absolute", width: 390, height: 844 }} />
          {/* Hold ring around the SOS button */}
          {t >= PRESS && (
            <svg width={390} height={844} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
              <circle cx={BTN[0]} cy={BTN[1]} r={46} fill="none" stroke="rgba(225,29,72,0.25)" strokeWidth={5} />
              <circle cx={BTN[0]} cy={BTN[1]} r={46} fill="none" stroke="#fff" strokeWidth={5} strokeLinecap="round" pathLength={1} strokeDasharray={`${hold} 2`} transform={`rotate(-90 ${BTN[0]} ${BTN[1]})`} />
            </svg>
          )}
          <Tap x={BTN[0]} y={BTN[1]} t={t - PRESS} hold={HOLD} />
        </Phone>
        </Cam>
      )}
      {t >= ALERT - 8 && (
        <>
          {split < 1 &&
            [0, 1].map((i) => {
              const w = (wave + i * 0.5) % 1;
              return <div key={i} style={{ position: "absolute", left: 540 - 380, top: 1210 - 380, width: 760, height: 760, borderRadius: "50%", border: `4px solid rgba(225,29,72,${0.5 * (1 - w) * (1 - map)})`, transform: `scale(${0.8 + w * 0.9})` }} />;
            })}
          <Phone width={maaW} style={{ left: maaLeft, top: 540 + split * 60, opacity: in2, transform: `translateY(${(1 - in2) * 120}px) rotate(${buzz + split * 3}deg)` }} glow="rgba(225,29,72,0.45)">
            <Img src={staticFile("screens/maa-incoming.png")} style={{ position: "absolute", width: 390, height: 844 }} />
            <Img src={staticFile("screens/maa-sos-map.png")} style={{ position: "absolute", width: 390, height: 844, opacity: map }} />
            {map > 0 && <div style={{ position: "absolute", left: 195 - 30, top: 193 - 30, width: 60, height: 60, borderRadius: 30, border: "3px solid #e11d48", opacity: 1 - pin, transform: `scale(${0.6 + pin * 2})` }} />}
          </Phone>
          {split > 0 && (
            <Phone width={500} style={{ left: 50 - (1 - split) * 600, top: 600, transform: `rotate(${-3 * split}deg)` }} glow="rgba(225,29,72,0.35)">
              <Img src={staticFile("screens/sos-answered.png")} style={{ position: "absolute", width: 390, height: 844 }} />
              <Marker box={[95, 296, 238, 318]} t={t - ANSWER - 10} color="#4ade9b" />
            </Phone>
          )}
          {split > 0 && (
            <>
              <div style={{ position: "absolute", left: 50, width: 500, top: 1680, textAlign: "center", color: C.ink, fontSize: 40, fontWeight: 800, opacity: split }}>Priya</div>
              <div style={{ position: "absolute", left: 550, width: 500, top: 1680, textAlign: "center", color: C.ink, fontSize: 40, fontWeight: 800, opacity: split }}>Maa</div>
            </>
          )}
        </>
      )}
      <AbsoluteFill style={{ background: C.sos, opacity: flash }} />
    </AbsoluteFill>
  );
}
