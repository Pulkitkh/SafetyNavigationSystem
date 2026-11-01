import { AbsoluteFill, interpolate } from "remotion";
import { Logo } from "../components/Logo";
import { useT } from "../components/Scene";
import { C, EASE, EASE_IN_OUT, FONT, POP } from "../theme";
import { cue } from "../timeline";

const FREE = cue("outro", "l16", 0) + 8;
const BROWSER = cue("outro", "l16", 1) + 2;
const ANDROID = BROWSER + 26;
const SLOGAN = cue("outro", "l17", 0);
const NIGHT = cue("outro", "l17", 1);

function Chip({ t, children, accent }: { t: number; children: React.ReactNode; accent?: boolean }) {
  const p = interpolate(t, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: POP });
  return (
    <div style={{ padding: "18px 30px", borderRadius: 999, background: accent ? C.good : C.surface2, boxShadow: accent ? "0 0 40px rgba(74,222,155,0.3)" : `0 0 0 2px ${C.line}`, color: accent ? "#fff" : C.ink, fontSize: 42, fontWeight: 800, opacity: p, transform: `scale(${0.7 + 0.3 * p})` }}>
      {children}
    </div>
  );
}

export function Outro() {
  const t = useT();
  const inP = interpolate(t, [-8, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const s2 = interpolate(t, [SLOGAN - 14, SLOGAN + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT });
  const g1 = interpolate(t, [SLOGAN - 2, SLOGAN + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const g2 = interpolate(t, [NIGHT - 2, NIGHT + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const url = interpolate(t, [ANDROID + 14, ANDROID + 28], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const follow = interpolate(t, [NIGHT + 30, NIGHT + 44], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const breathe = 1 + 0.015 * Math.sin(t / 20);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 90% 60% at 50% 45%, #2a1d6e 0%, ${C.canvas} 70%)`, fontFamily: FONT, overflow: "hidden" }}>
      {/* Mark and name: centred first, then they step up for the line */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 470 - s2 * 60, display: "flex", flexDirection: "column", alignItems: "center", opacity: inP, transform: `scale(${(1 - s2 * 0.35) * breathe})`, transformOrigin: "50% 0" }}>
        <div style={{ filter: "drop-shadow(0 24px 50px rgba(91,63,214,0.6))" }}>
          <Logo size={230} />
        </div>
        <div style={{ marginTop: 26, color: C.ink, fontSize: 124, fontWeight: 800, letterSpacing: -4 }}>SafeNav</div>
      </div>
      <div style={{ position: "absolute", left: 40, right: 40, top: 1010, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 22, opacity: 1 - s2, transform: `translateY(${s2 * -30}px)` }}>
        <Chip t={t - FREE} accent>Free</Chip>
        <Chip t={t - BROWSER}>In your browser</Chip>
        <Chip t={t - ANDROID}>On Android</Chip>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 920, textAlign: "center", fontSize: 128, fontWeight: 800, letterSpacing: -4, lineHeight: 1.08 }}>
        <div style={{ color: C.ink, opacity: g1, transform: `translateY(${(1 - g1) * 30}px)` }}>Get home safe.</div>
        <div style={{ color: C.brandInk, opacity: g2, transform: `translateY(${(1 - g2) * 30}px)` }}>Every night.</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1330, display: "flex", justifyContent: "center", opacity: url, transform: `translateY(${(1 - url) * 20}px)` }}>
        <div style={{ padding: "22px 40px", borderRadius: 999, background: "rgba(124,92,255,0.18)", boxShadow: "0 0 0 2px rgba(178,165,255,0.5)", color: C.ink, fontSize: 44, fontWeight: 700 }}>safenav-0ywr.onrender.com</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1460, textAlign: "center", color: C.ink2, fontSize: 38, fontWeight: 700, opacity: follow }}>
        Follow for more  →
      </div>
    </AbsoluteFill>
  );
}
