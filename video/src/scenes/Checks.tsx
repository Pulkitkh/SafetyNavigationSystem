import { AbsoluteFill, Img, interpolate, staticFile } from "remotion";
import { AppBg } from "../components/AppBg";
import { Icon } from "../components/Icons";
import { useT } from "../components/Scene";
import { rand } from "../util";
import { C, EASE, EASE_IN_OUT, FONT, POP } from "../theme";
import { cue } from "../timeline";

const CHIPS = [
  { label: "Street lights", icon: "light", color: C.lamp },
  { label: "Open shops", icon: "store", color: C.goodHi },
  { label: "Footpaths", icon: "foot", color: "#7cc4ff" },
  { label: "Police nearby", icon: "shield", color: C.brandInk },
  { label: "Time of night", icon: "moon", color: "#f4efe0" },
] as const;
const AT = CHIPS.map((_, i) => cue("checks", "l10", i));

const CARD = { left: 60, top: 480, w: 960, h: 600 };
const K = CARD.w / 390; // screenshot px -> frame px
const CROP_Y = 46; // skip the app header

export function Checks() {
  const t = useT();
  const inP = interpolate(t, [-8, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const push = interpolate(t, [0, 192], [1, 1.08], { easing: EASE_IN_OUT });
  const scan = ((t + 10) % 64) / 64;
  const streets = Math.round(interpolate(t, [0, AT[4] + 10], [0, 2030], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }));
  return (
    <AbsoluteFill style={{ fontFamily: FONT, overflow: "hidden" }}>
      <AppBg seed={13} />
      <div style={{ position: "absolute", left: CARD.left, top: CARD.top, width: CARD.w, height: CARD.h, borderRadius: 44, overflow: "hidden", opacity: inP, transform: `scale(${0.94 + 0.06 * inP})`, boxShadow: "0 0 0 2px rgba(178,165,255,0.35), 0 40px 100px rgba(0,0,0,0.6), 0 0 120px rgba(124,92,255,0.3)" }}>
        <div style={{ position: "absolute", inset: 0, transform: `scale(${push})`, transformOrigin: "60% 50%" }}>
          <Img src={staticFile("screens/plan-routes.png")} style={{ position: "absolute", left: 0, top: -CROP_Y * K, width: CARD.w, height: 844 * K }} />
          {/* Each check lands on the map as a few pings in its colour */}
          {CHIPS.map((c, ci) =>
            Array.from({ length: 7 }).map((_, j) => {
              const lt = t - AT[ci] - j * 2;
              if (lt < 0 || lt > 40) return null;
              const p = lt / 40;
              const x = 80 + rand(ci * 31 + j) * 800;
              const y = 60 + rand(ci * 17 + j * 5 + 3) * 480;
              return (
                <div key={`${ci}-${j}`} style={{ position: "absolute", left: x - 30, top: y - 30, width: 60, height: 60, borderRadius: 30, border: `4px solid ${c.color}`, opacity: 1 - p, transform: `scale(${0.3 + p * 1.2})` }}>
                  <div style={{ position: "absolute", left: 22, top: 22, width: 8, height: 8, borderRadius: 4, background: c.color }} />
                </div>
              );
            }),
          )}
        </div>
        {/* Scan line */}
        <div style={{ position: "absolute", left: 0, right: 0, top: scan * CARD.h - 120, height: 120, background: "linear-gradient(rgba(124,92,255,0) 0%, rgba(124,92,255,0.22) 85%, rgba(178,165,255,0.9) 100%)" }} />
        <div style={{ position: "absolute", left: 24, bottom: 24, padding: "14px 24px", borderRadius: 999, background: "rgba(12,11,20,0.85)", color: C.ink, fontSize: 32, fontWeight: 800, display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ width: 14, height: 14, borderRadius: 7, background: C.goodHi, boxShadow: `0 0 12px ${C.goodHi}` }} />
          {streets.toLocaleString("en-IN")} streets checked
        </div>
      </div>
      {CHIPS.map((c, i) => {
        const p = interpolate(t, [AT[i] - 2, AT[i] + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: POP });
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = i === 4 ? 540 - 220 : 60 + col * 500;
        return (
          <div
            key={c.label}
            style={{
              position: "absolute",
              left: x,
              top: 1130 + row * 134,
              width: 460,
              height: 110,
              borderRadius: 30,
              background: C.surface,
              boxShadow: `0 0 0 2px ${C.line}`,
              display: "flex",
              alignItems: "center",
              gap: 22,
              paddingLeft: 22,
              opacity: p,
              transform: `translateY(${(1 - p) * 30}px) scale(${0.85 + 0.15 * p})`,
            }}
          >
            <div style={{ width: 68, height: 68, borderRadius: 22, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name={c.icon} size={40} color={c.color} />
            </div>
            <div style={{ color: C.ink, fontSize: 40, fontWeight: 800 }}>{c.label}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
