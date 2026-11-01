import { AbsoluteFill, interpolate } from "remotion";
import { useT } from "../components/Scene";
import { Bokeh } from "../components/Bokeh";
import { Phone } from "../components/Phone";
import { C, EASE, EASE_OUT, FONT, POP } from "../theme";
import { chunkFrame, sceneFrames } from "../timeline";

const S = sceneFrames("routine");
const KEYS = chunkFrame("l02", 1) - S.from;
const PHONE = chunkFrame("l02", 2) - S.from;
const TEXT = chunkFrame("l02", 3) - S.from;

function Keys({ t }: { t: number }) {
  const p = interpolate(t, [0, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: POP });
  const swing = Math.sin(t / 5) * 6 * Math.exp(-t / 40);
  return (
    <svg viewBox="0 0 260 360" width={300} height={415} style={{ position: "absolute", left: 70, top: 980, opacity: p, transform: `translateX(${(1 - p) * -160}px) rotate(${-18 + swing}deg)`, transformOrigin: "130px 40px" }}>
      <defs>
        <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eef0f7" />
          <stop offset="0.5" stopColor="#9da2b8" />
          <stop offset="1" stopColor="#5d6178" />
        </linearGradient>
      </defs>
      <circle cx="130" cy="58" r="44" fill="none" stroke="url(#metal)" strokeWidth="9" />
      <g transform="rotate(14 130 100)">
        <circle cx="118" cy="128" r="30" fill="url(#metal)" />
        <circle cx="118" cy="128" r="10" fill="#0c0b14" />
        <path d="M108 150 L128 150 L128 300 L118 316 L108 300 L108 284 L96 284 L96 268 L108 268 L108 246 L98 246 L98 232 L108 232 Z" fill="url(#metal)" />
      </g>
      <g transform="rotate(-22 130 100)">
        <rect x="132" y="96" width="44" height="52" rx="10" fill="#3b2f8f" />
        <path d="M146 146 L162 146 L162 286 L154 298 L146 286 L146 270 L136 270 L136 256 L146 256 Z" fill="url(#metal)" />
      </g>
    </svg>
  );
}

function Bubble({ text, me, t, y }: { text: string; me?: boolean; t: number; y: number }) {
  const p = interpolate(t, [0, 9], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: POP });
  if (t < 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: y,
        [me ? "right" : "left"]: 16,
        maxWidth: 250,
        padding: "11px 15px",
        borderRadius: 20,
        borderBottomRightRadius: me ? 6 : 20,
        borderBottomLeftRadius: me ? 20 : 6,
        background: me ? C.brand : C.surface2,
        color: "#fff",
        fontFamily: FONT,
        fontSize: 17,
        fontWeight: 600,
        lineHeight: 1.3,
        opacity: p,
        transform: `scale(${0.8 + 0.2 * p})`,
        transformOrigin: me ? "100% 100%" : "0% 100%",
      }}
    >
      {text}
    </div>
  );
}

const TYPED = "Leaving now. Home in 20 min.";

function Chat({ t }: { t: number }) {
  const typedChars = Math.round(interpolate(t, [TEXT + 4, TEXT + 34], [0, TYPED.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const sent = t >= TEXT + 40;
  return (
    <div style={{ position: "absolute", inset: 0, background: C.canvas, fontFamily: FONT }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 108, background: C.surface, borderBottom: `1px solid ${C.line}` }}>
        <div style={{ position: "absolute", left: 20, top: 54, width: 40, height: 40, borderRadius: 20, background: "#ffe1ea", color: "#8f0f2e", fontWeight: 800, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>M</div>
        <div style={{ position: "absolute", left: 72, top: 54, color: C.ink, fontWeight: 800, fontSize: 19 }}>Maa</div>
        <div style={{ position: "absolute", left: 72, top: 78, color: C.goodHi, fontWeight: 600, fontSize: 13 }}>online</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 120, textAlign: "center", color: C.ink3, fontSize: 13, fontWeight: 700 }}>Today 9:58 pm</div>
      <Bubble text="Class over?" t={t - (PHONE + 6)} y={160} />
      <Bubble text="Coming home now?" t={t - (PHONE + 16)} y={214} />
      {sent && <Bubble text={TYPED} me t={t - (TEXT + 40)} y={272} />}
      <Bubble text="Text me when you reach." t={t - (TEXT + 62)} y={sent ? 350 : 330} />
      <div style={{ position: "absolute", left: 14, right: 14, bottom: 34, height: 56, borderRadius: 28, background: C.surface2, display: "flex", alignItems: "center", paddingLeft: 20, color: typedChars && !sent ? C.ink : C.ink3, fontSize: 17, fontWeight: 600 }}>
        {!sent && typedChars ? TYPED.slice(0, typedChars) : "Message"}
        {!sent && typedChars > 0 && <span style={{ width: 2, height: 22, background: C.brandInk, marginLeft: 2, opacity: Math.floor(t / 8) % 2 ? 1 : 0.2 }} />}
        <div style={{ position: "absolute", right: 6, width: 44, height: 44, borderRadius: 22, background: C.brand, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m22 2-7 20-4-9-9-4Z" />
            <path d="M22 2 11 13" />
          </svg>
        </div>
      </div>
    </div>
  );
}

/** Scene 2: the routine. Keys between the fingers, phone ready, a text to Maa. */
export function Routine() {
  const t = useT();
  const enter = interpolate(t, [0, 30], [0, 1], { extrapolateRight: "clamp", easing: EASE });
  const screenOn = interpolate(t, [PHONE - 4, PHONE + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 90% 70% at 50% 60%, #1a1540 0%, ${C.canvas} 70%)`, overflow: "hidden" }}>
      <Bokeh />
      <Phone width={540} style={{ left: 400, top: 520 + (1 - enter) * 120, transform: `rotate(${4 - enter * 2}deg)`, opacity: enter }} glow={`rgba(124,92,255,${0.1 + 0.3 * screenOn})`}>
        <div style={{ position: "absolute", inset: 0, opacity: screenOn }}>
          <Chat t={t} />
        </div>
      </Phone>
      <Keys t={t - KEYS} />
    </AbsoluteFill>
  );
}
