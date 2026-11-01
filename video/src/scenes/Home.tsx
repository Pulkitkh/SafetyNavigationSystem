import { AbsoluteFill, Img, interpolate, staticFile } from "remotion";
import { Icon } from "../components/Icons";
import { Phone } from "../components/Phone";
import { Priya } from "../components/Priya";
import { useT } from "../components/Scene";
import { Tap } from "../components/Tap";
import { C, EASE, EASE_IN_OUT, EASE_OUT, FONT } from "../theme";
import { cue } from "../timeline";

const SAFE = cue("home", "l15", 1);
const SEES = cue("home", "l15", 2);
const TAP = SEES + 20;
const BANNER = TAP + 14;
const GROUND = 1500;
const DOOR = { left: 560, top: 960, w: 230, h: 540 };

export function Home() {
  const t = useT();
  const walkX = interpolate(t, [-10, 40], [60, 330], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  const walking = t < 40;
  const open = interpolate(t, [SAFE - 6, SAFE + 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT });
  const rise = interpolate(t, [SEES - 6, SEES + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const banner = interpolate(t, [BANNER, BANNER + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const push = interpolate(t, [0, 180], [1, 1.06]);
  const warm = `rgba(255,207,122,${0.25 + 0.55 * open})`;
  return (
    <AbsoluteFill style={{ background: C.canvas, overflow: "hidden", fontFamily: FONT }}>
      <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: "540px 1200px", filter: `blur(${rise * 7}px) brightness(${1 - rise * 0.3})` }}>
        <AbsoluteFill style={{ background: `linear-gradient(${C.skyTop} 0%, #120e2c 40%, ${C.skyBottom} 70%)` }} />
        {/* House */}
        <div style={{ position: "absolute", left: 120, top: 620, width: 840, height: GROUND - 620, background: "#16132c" }} />
        <div style={{ position: "absolute", left: 80, top: 560, width: 920, height: 70, background: "#100d22" }} />
        {[200, 820].map((x) => (
          <div key={x} style={{ position: "absolute", left: x - 70, top: 780, width: 140, height: 190, background: "linear-gradient(#ffcf7a66, #ffb35a33)", boxShadow: "0 0 70px rgba(255,207,122,0.25)", border: "8px solid #0e0b1f" }} />
        ))}
        {/* Doorway: warm light grows as the door swings open */}
        <div style={{ position: "absolute", left: DOOR.left - 18, top: DOOR.top - 18, width: DOOR.w + 36, height: DOOR.h + 18, background: "#0e0b1f" }} />
        <div style={{ position: "absolute", left: DOOR.left, top: DOOR.top, width: DOOR.w, height: DOOR.h, background: `linear-gradient(#ffe2a8, #ffbe6e)`, opacity: open, boxShadow: `0 0 ${140 * open}px rgba(255,207,122,${0.6 * open})` }} />
        <div style={{ position: "absolute", left: DOOR.left, top: DOOR.top, width: DOOR.w, height: DOOR.h, background: "#2a2147", transformOrigin: "0 50%", transform: `perspective(900px) rotateY(${-72 * open}deg)` }}>
          <div style={{ position: "absolute", right: 22, top: 270, width: 14, height: 14, borderRadius: 7, background: "#b9a46a" }} />
        </div>
        <div style={{ position: "absolute", left: DOOR.left + DOOR.w + 30, top: DOOR.top + 140, padding: "6px 14px", borderRadius: 6, background: "#2a2147", color: "#d9cfa8", fontSize: 24, fontWeight: 700 }}>Sharma</div>
        {/* Porch light */}
        <div style={{ position: "absolute", left: DOOR.left + DOOR.w / 2 - 330, top: DOOR.top - 260, width: 660, height: 900, background: "radial-gradient(ellipse 50% 50% at 50% 30%, rgba(255,207,122,0.28) 0%, rgba(255,207,122,0) 100%)" }} />
        <div style={{ position: "absolute", left: DOOR.left + DOOR.w / 2 - 26, top: DOOR.top - 74, width: 52, height: 30, borderRadius: "0 0 26px 26px", background: C.lamp, boxShadow: "0 10px 60px rgba(255,207,122,0.9)" }} />
        {/* Light on the step */}
        <div style={{ position: "absolute", left: DOOR.left - 200, top: GROUND - 20, width: DOOR.w + 400, height: 160, background: `radial-gradient(ellipse 50% 50% at 50% 20%, rgba(255,207,122,${0.45 * open}) 0%, rgba(255,207,122,0) 100%)` }} />
        <div style={{ position: "absolute", left: 0, top: GROUND, width: 1080, height: 420, background: "#0b0916" }} />
        {/* Priya at her door */}
        <div style={{ position: "absolute", left: walkX, top: GROUND - 620, width: 252, height: 640 }}>
          <Priya phase={(t / 34) * 2 * Math.PI} walking={walking} rim={warm} />
        </div>
      </AbsoluteFill>
      {rise > 0 && (
        <Phone width={600} style={{ left: 240, top: 640 + (1 - rise) * 1300 }}>
          <Img src={staticFile("screens/arrived.png")} style={{ position: "absolute", width: 390, height: 844 }} />
          <Tap x={195} y={676} t={t - TAP} />
        </Phone>
      )}
      {/* The text Maa receives */}
      <div style={{ position: "absolute", left: 60, right: 60, top: 450 - (1 - banner) * 160, opacity: banner, padding: "26px 30px", borderRadius: 36, background: "rgba(31,30,43,0.96)", boxShadow: "0 30px 80px rgba(0,0,0,0.55), 0 0 0 2px rgba(255,255,255,0.06)", display: "flex", gap: 24, alignItems: "center" }}>
        <div style={{ width: 84, height: 84, flexShrink: 0, borderRadius: 22, background: C.good, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="message" size={46} color="#fff" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: C.ink3, fontSize: 26, fontWeight: 700 }}>
            <span>MESSAGES · to Maa</span>
            <span>now</span>
          </div>
          <div style={{ color: C.ink, fontSize: 34, fontWeight: 700, marginTop: 6, lineHeight: 1.25 }}>Priya Sharma reached Palasia Square safely.</div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
