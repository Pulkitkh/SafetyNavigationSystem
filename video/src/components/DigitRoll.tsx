import { interpolate } from "remotion";
import { EASE_OUT } from "../theme";

/**
 * An odometer: each digit spins down its own strip and lands left to right.
 * Separators (commas) stay put. `t` is frames since the roll began.
 */
export function DigitRoll({ value, t, dur = 40, size = 200, color, stagger = 4 }: { value: string; t: number; dur?: number; size?: number; color: string; stagger?: number }) {
  const h = size * 1.08;
  let digitIndex = 0;
  const digits = value.replace(/\D/g, "").length;
  return (
    <div style={{ display: "flex", height: h, overflow: "hidden", fontSize: size, lineHeight: `${h}px`, fontWeight: 800, color, letterSpacing: -size * 0.03, fontVariantNumeric: "tabular-nums" }}>
      {value.split("").map((ch, i) => {
        if (!/\d/.test(ch)) return <span key={i}>{ch}</span>;
        const d = Number(ch);
        const k = digitIndex++;
        const loops = 2 + (digits - k > 3 ? 0 : 1); // trailing digits spin a little more
        const start = k * stagger;
        const p = interpolate(t, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
        const pos = p * (loops * 10 + d);
        const shown = Math.floor(pos);
        const frac = pos - shown;
        const blur = Math.min(10, Math.abs(1 - p) * 14);
        return (
          <span key={i} style={{ position: "relative", display: "inline-block", width: "0.62em", height: h }}>
            {[shown, shown + 1].map((n, j) => (
              <span key={j} style={{ position: "absolute", left: 0, right: 0, textAlign: "center", top: (j - frac) * h, filter: `blur(${p >= 1 ? 0 : blur * 0.25}px)` }}>
                {n % 10}
              </span>
            ))}
          </span>
        );
      })}
    </div>
  );
}
