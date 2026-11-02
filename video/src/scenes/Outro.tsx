import { AbsoluteFill, interpolate } from "remotion";
import { Logo } from "../components/Logo";
import { useT } from "../components/Scene";
import { C, EASE, EASE_IN_OUT, FONT, POP } from "../theme";
import { cue, tr } from "../timeline";

const SOON = cue("outro", "l16", 0) + 10;
const EARLY = cue("outro", "l16", 1) + 4;
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
  const follow = interpolate(t, [NIGHT + 30, NIGHT + 44], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const follow2 = interpolate(t, [NIGHT + 44, NIGHT + 58], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
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
        <Chip t={t - SOON} accent>{tr("Coming soon", "जल्द आ रहा है")}</Chip>
        <Chip t={t - EARLY}>{tr("Follow for early access", "अर्ली एक्सेस के लिए फ़ॉलो करें")}</Chip>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 920, textAlign: "center", fontSize: 128, fontWeight: 800, letterSpacing: -4, lineHeight: 1.08 }}>
        <div style={{ color: C.ink, opacity: g1, transform: `translateY(${(1 - g1) * 30}px)` }}>{tr("Get home safe.", "सुरक्षित घर पहुँचिए।")}</div>
        <div style={{ color: C.brandInk, opacity: g2, transform: `translateY(${(1 - g2) * 30}px)` }}>{tr("Every night.", "हर रात।")}</div>
      </div>
      {/* Engagement: a share prompt that echoes the hook, and the series */}
      <div style={{ position: "absolute", left: 80, right: 80, top: 1330, textAlign: "center", color: C.ink, fontSize: 42, fontWeight: 700, lineHeight: 1.25, opacity: follow, transform: `translateY(${(1 - follow) * 16}px)` }}>
        {tr("Send this to someone who always texts", "उसे भेजिए जो हमेशा मैसेज करती है")} <span style={{ color: C.brandInk }}>{tr("“reached”", "“पहुँच गई”")}</span>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1460, textAlign: "center", color: C.brandInk, fontSize: 34, fontWeight: 700, opacity: follow2 }}>
        {tr("Follow for part 2: how SafeNav scores a street", "पार्ट 2 के लिए फ़ॉलो करें: SafeNav गली को कैसे परखता है")}  →
      </div>
    </AbsoluteFill>
  );
}
