import { AbsoluteFill, interpolate } from "remotion";
import { Bokeh } from "../components/Bokeh";
import { DigitRoll } from "../components/DigitRoll";
import { useT } from "../components/Scene";
import { rand } from "../util";
import { C, EASE, EASE_OUT, FONT } from "../theme";
import { cue, tr } from "../timeline";

const ROLL = cue("numbers", "l03", 1) - 4; // "India recorded over 4 lakh…"
const LABEL = cue("numbers", "l03", 2);
const DAY = cue("numbers", "l04", 0);
const EVERY = cue("numbers", "l04", 1);

// 1,228 dots, one for each woman, every day.
const COLS = 44;
const DOTS = 1228;

export function Numbers() {
  const t = useT();
  const yearIn = interpolate(t, [0, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  const labelIn = interpolate(t, [LABEL, LABEL + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  // At "every single day" the big total steps back and the day's dots fill in.
  const swap = interpolate(t, [DAY - 6, DAY + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const fill = interpolate(t, [DAY + 6, EVERY + 26], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pulse = t > EVERY + 26 ? 0.5 + 0.5 * Math.sin((t - EVERY) / 7) : 1;
  const grid = 900;
  const cell = grid / COLS;
  const rows = Math.ceil(DOTS / COLS);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 90% 60% at 50% 55%, #1b1236 0%, ${C.canvas} 72%)`, fontFamily: FONT, overflow: "hidden" }}>
      <div style={{ opacity: 0.35 }}>
        <Bokeh seed={21} count={12} warm={false} />
      </div>
      {/* The year's total */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 660 - swap * 120, display: "flex", flexDirection: "column", alignItems: "center", transform: `scale(${1 - swap * 0.42})`, transformOrigin: "50% 0", opacity: 1 - swap * 0.35 }}>
        <div style={{ color: C.brandInk, fontSize: 44, fontWeight: 700, letterSpacing: 6, opacity: yearIn, transform: `translateY(${(1 - yearIn) * 20}px)` }}>{tr("INDIA · 2023", "भारत · 2023")}</div>
        <div style={{ marginTop: 18, opacity: t >= ROLL ? 1 : 0 }}>
          <DigitRoll value="4,48,211" t={t - ROLL} dur={46} size={190} color={C.ink} />
        </div>
        <div style={{ marginTop: 10, color: C.ink2, fontSize: 46, fontWeight: 700, opacity: labelIn, transform: `translateY(${(1 - labelIn) * 16}px)` }}>
          {tr("crimes against women, recorded", "महिलाओं के ख़िलाफ़ दर्ज अपराध")}
        </div>
      </div>
      {/* Every day */}
      <div style={{ position: "absolute", left: (1080 - grid) / 2, top: 900, width: grid, height: rows * cell, opacity: swap }}>
        {Array.from({ length: DOTS }).map((_, i) => {
          const order = (i + rand(i) * 60) / (DOTS + 60);
          const on = order < fill;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: (i % COLS) * cell + cell * 0.2,
                top: Math.floor(i / COLS) * cell + cell * 0.2,
                width: cell * 0.6,
                height: cell * 0.6,
                borderRadius: cell,
                background: on ? C.sos : "#2a2440",
                opacity: on ? 0.55 + 0.45 * pulse : 0.6,
              }}
            />
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 900 + rows * cell + 40, display: "flex", justifyContent: "center", alignItems: "baseline", gap: 18, opacity: swap }}>
        <DigitRoll value="1,228" t={t - DAY - 4} dur={38} size={120} color={C.sos} />
        <div style={{ color: C.ink, fontSize: 54, fontWeight: 800 }}>{tr("a day", "हर दिन")}</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 120, textAlign: "center", color: C.ink3, fontSize: 28, fontWeight: 600, opacity: labelIn * 0.9 }}>
        {tr("Source", "स्रोत")}: NCRB, Crime in India 2023<span style={{ opacity: swap }}> · {tr("each dot is one case", "हर बिंदु एक मामला")}</span>
      </div>
    </AbsoluteFill>
  );
}
