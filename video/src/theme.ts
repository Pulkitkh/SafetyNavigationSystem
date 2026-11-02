import { Easing } from "remotion";
import { FONT_DATA } from "./font-data";
import { MUKTA } from "./font-data-hi";
import { LANG } from "./timeline";

/** SafeNav's own tokens (src/app/globals.css), extended only for the night scenes. */
export const C = {
  canvas: "#0c0b14",
  surface: "#16151f",
  surface2: "#1f1e2b",
  line: "#2b2a3a",
  ink: "#f1f0f7",
  ink2: "#c3c1d6",
  ink3: "#9a98b0",
  brand: "#5b3fd6",
  brandHi: "#7c5cff",
  brandDeep: "#3a2aa8",
  brandInk: "#b2a5ff",
  good: "#0f7a55",
  goodHi: "#4ade9b",
  caution: "#fbbf4a",
  sos: "#e11d48",
  sosDeep: "#8f0f2e",
  lamp: "#ffcf7a",
  skyTop: "#07060d",
  skyBottom: "#1d1747",
};

// Latin from the app's own face; Devanagari falls through to Mukta, glyph by glyph.
export const FONT = "'Plus Jakarta Sans', 'Mukta', system-ui, sans-serif";

/** Trust: entrances without bounce. Pop: a small overshoot, only for chips that "land". */
export const EASE = Easing.bezier(0.25, 0.46, 0.45, 0.94);
export const EASE_OUT = Easing.bezier(0, 0, 0.2, 1);
export const EASE_IN_OUT = Easing.bezier(0.45, 0, 0.55, 1);
export const POP = Easing.bezier(0.34, 1.4, 0.64, 1);

let fontLoaded = false;
/**
 * Registers the embedded font as a stylesheet rule. It is a data URL, so the
 * browser has it within a few frames; nothing in the video shows text before
 * the first caption at about 1 s, so no frame waits on it.
 */
export function loadFont() {
  if (fontLoaded || typeof document === "undefined") return;
  fontLoaded = true;
  const style = document.createElement("style");
  style.textContent =
    `@font-face { font-family: "Plus Jakarta Sans"; src: url(${FONT_DATA}) format("woff2"); font-weight: 200 800; font-display: block; }` +
    (LANG === "hi"
      ? Object.entries(MUKTA)
          .map(([w, src]) => `@font-face { font-family: "Mukta"; src: url(${src}) format("woff2"); font-weight: ${w}; font-display: block; unicode-range: U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+20A8, U+20B9, U+25CC, U+A830-A839, U+A8E0-A8FF; }`)
          .join("")
      : "");
  document.head.appendChild(style);
  void document.fonts.load('800 66px "Plus Jakarta Sans"');
  if (LANG === "hi") for (const w of [600, 700, 800]) void document.fonts.load(`${w} 66px "Mukta"`, "हिन्दी");
}
