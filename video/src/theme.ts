import { Easing } from "remotion";
import { FONT_DATA } from "./font-data";

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

export const FONT = "'Plus Jakarta Sans', system-ui, sans-serif";

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
  style.textContent = `@font-face { font-family: "Plus Jakarta Sans"; src: url(${FONT_DATA}) format("woff2"); font-weight: 200 800; font-display: block; }`;
  document.head.appendChild(style);
  void document.fonts.load('800 66px "Plus Jakarta Sans"');
}
