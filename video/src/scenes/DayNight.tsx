import { AbsoluteFill, interpolate } from "remotion";
import { Ring } from "../components/Ring";
import { useT } from "../components/Scene";
import { C, EASE, EASE_OUT, FONT } from "../theme";
import { cue } from "../timeline";

const DAY = cue("daynight", "l05", 0);
const NIGHT = cue("daynight", "l05", 1);
const HALF = cue("daynight", "l05", 2);

function Card({ t, top, night, pct, label }: { t: number; top: number; night?: boolean; pct: number; label: string }) {
  const inP = interpolate(t, [0, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const fill = interpolate(t, [8, 44], [0, pct / 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  const n = Math.round(fill * 100);
  const color = night ? C.caution : C.goodHi;
  return (
    <div
      style={{
        position: "absolute",
        left: 70,
        right: 70,
        top,
        height: 470,
        borderRadius: 48,
        overflow: "hidden",
        opacity: inP,
        transform: `translateY(${(1 - inP) * 60}px)`,
        background: night ? "linear-gradient(160deg, #1d1747 0%, #0c0b14 100%)" : "linear-gradient(160deg, #ffe7b0 0%, #ffc979 45%, #f29a6b 100%)",
        boxShadow: night ? `0 0 0 2px ${C.line}` : "0 30px 80px rgba(242,154,107,0.25)",
      }}
    >
      {night ? (
        <>
          {Array.from({ length: 22 }).map((_, i) => (
            <div key={i} style={{ position: "absolute", left: (i * 157) % 940, top: 30 + ((i * 89) % 380), width: 3, height: 3, borderRadius: 2, background: "#fff", opacity: 0.25 + 0.4 * Math.abs(Math.sin(t / 15 + i)) }} />
          ))}
          <div style={{ position: "absolute", right: 120, top: 70, width: 92, height: 92, borderRadius: 46, boxShadow: "-22px 8px 0 0 #f4efe0", filter: "drop-shadow(0 0 14px rgba(244,239,224,0.45))" }} />
        </>
      ) : (
        <div style={{ position: "absolute", right: 90, top: 60, width: 120, height: 120, borderRadius: 60, background: "#fff6dc", boxShadow: "0 0 60px 20px rgba(255,246,220,0.7)" }} />
      )}
      <div style={{ position: "absolute", left: 60, top: 95 }}>
        <Ring size={280} stroke={26} p={fill} color={night ? color : "#0f7a55"} track={night ? "#2b2a3a" : "rgba(255,255,255,0.45)"} />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontWeight: 800, fontSize: 96, color: night ? C.ink : "#3a1d0a", letterSpacing: -3 }}>
          {n}%
        </div>
      </div>
      <div style={{ position: "absolute", left: 390, top: 180, right: 50, fontFamily: FONT }}>
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 4, color: night ? C.brandInk : "#7a3a12" }}>{night ? "AFTER DARK" : "DURING THE DAY"}</div>
        <div style={{ marginTop: 10, fontSize: 52, fontWeight: 800, lineHeight: 1.1, color: night ? C.ink : "#3a1d0a" }}>{label}</div>
      </div>
    </div>
  );
}

export function DayNight() {
  const t = useT();
  const src = interpolate(t, [HALF, HALF + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: C.canvas, fontFamily: FONT }}>
      <Card t={t - DAY + 6} top={540} pct={82} label="of women feel safe" />
      <Card t={t - NIGHT + 2} top={1060} night pct={48} label="feel safe" />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 230, textAlign: "center", color: C.ink3, fontSize: 28, fontWeight: 600, opacity: src }}>
        Source: She Shakti Suraksha Survey 2025, CNN-News18
      </div>
    </AbsoluteFill>
  );
}
