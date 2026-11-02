import { AbsoluteFill, interpolate } from "remotion";
import { Logo } from "../components/Logo";
import { useT } from "../components/Scene";
import { C, EASE, EASE_OUT, FONT, POP } from "../theme";
import { cue, f, REVEAL_IMPACT_S, SCENES, tr } from "../timeline";

const IMPACT = f(REVEAL_IMPACT_S) - f(SCENES.reveal.from);
const WORD = cue("reveal", "l07", 0);
const TAG = cue("reveal", "l08", 0);
const TAG2 = cue("reveal", "l08", 1);

export function Reveal() {
  const t = useT();
  const charge = interpolate(t, [-8, IMPACT], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing2 });
  const hit = t >= IMPACT;
  const pop = interpolate(t, [IMPACT, IMPACT + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: POP });
  const ring = interpolate(t, [IMPACT, IMPACT + 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  const flash = interpolate(t, [IMPACT, IMPACT + 3, IMPACT + 20], [0, 0.55, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const lift = interpolate(t, [WORD - 6, WORD + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const tag = interpolate(t, [TAG - 2, TAG + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const tag2 = interpolate(t, [TAG2 - 2, TAG2 + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const drift = interpolate(t, [IMPACT, 200], [1, 1.04]);
  const logoY = 760 - lift * 120;
  return (
    <AbsoluteFill style={{ background: "#07060d", fontFamily: FONT, overflow: "hidden" }}>
      {/* Brand light that grows into the impact, then settles as a glow */}
      <div
        style={{
          position: "absolute",
          left: 540 - 700,
          top: logoY + 150 - 700,
          width: 1400,
          height: 1400,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(124,92,255,${hit ? 0.42 : 0.5 * charge}) 0%, rgba(91,63,214,${hit ? 0.16 : 0.1 * charge}) 35%, rgba(91,63,214,0) 68%)`,
          transform: `scale(${hit ? 1 : 0.2 + 0.4 * charge})`,
        }}
      />
      {!hit && <div style={{ position: "absolute", left: 540 - 9, top: logoY + 150 - 9, width: 18, height: 18, borderRadius: 9, background: "#fff", boxShadow: `0 0 ${30 + 60 * charge}px ${10 + 20 * charge}px rgba(178,165,255,0.9)`, transform: `scale(${0.4 + charge})` }} />}
      {hit && (
        <div
          style={{
            position: "absolute",
            left: 540 - 300,
            top: logoY + 150 - 300,
            width: 600,
            height: 600,
            borderRadius: "50%",
            border: `${6 * (1 - ring) + 1}px solid rgba(178,165,255,${0.8 * (1 - ring)})`,
            transform: `scale(${0.4 + ring * 1.8})`,
          }}
        />
      )}
      <div style={{ position: "absolute", left: 540 - 150, top: logoY, width: 300, height: 300, opacity: hit ? 1 : 0, transform: `scale(${(0.55 + 0.45 * pop) * drift})`, filter: "drop-shadow(0 30px 60px rgba(91,63,214,0.55))" }}>
        <Logo size={300} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1090, textAlign: "center", color: C.ink, fontWeight: 800, fontSize: 150, letterSpacing: -5, opacity: lift, transform: `translateY(${(1 - lift) * 40}px)` }}>
        SafeNav
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1300, textAlign: "center", fontWeight: 700, fontSize: 60, lineHeight: 1.2, color: C.ink2 }}>
        <div style={{ opacity: tag, transform: `translateY(${(1 - tag) * 24}px)` }}>{tr("Navigation that puts", "ऐसा नेविगेशन, जो रखे")}</div>
        <div style={{ opacity: tag2, transform: `translateY(${(1 - tag2) * 24}px)`, color: C.brandInk, fontWeight: 800 }}>{tr("your safety first.", "आपकी सुरक्षा सबसे पहले।")}</div>
      </div>
      <AbsoluteFill style={{ background: "#fff", opacity: flash }} />
    </AbsoluteFill>
  );
}

function Easing2(x: number) {
  return x * x * x;
}
