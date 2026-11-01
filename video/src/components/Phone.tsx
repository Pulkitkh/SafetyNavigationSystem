import type { CSSProperties, ReactNode } from "react";
import { Img, staticFile } from "remotion";

/** Screenshots are 390×844 CSS px at 3x (1170×2532). */
export const SCREEN_W = 390;
export const SCREEN_H = 844;

/**
 * A phone around a real SafeNav screenshot. `zoom` and `focus` move a camera
 * inside the screen (focus in screenshot CSS px), so a detail can be brought
 * close without leaving the device. Children are drawn in screen space.
 */
export function Phone({
  src,
  width = 620,
  zoom = 1,
  focus,
  style,
  glow = "rgba(124,92,255,0.35)",
  children,
  overlay,
}: {
  src?: string;
  width?: number;
  zoom?: number;
  focus?: [number, number];
  style?: CSSProperties;
  glow?: string;
  children?: ReactNode;
  overlay?: ReactNode;
}) {
  const bezel = width * 0.035;
  const innerW = width - bezel * 2;
  const k = innerW / SCREEN_W;
  const innerH = SCREEN_H * k;
  const height = innerH + bezel * 2;
  const radius = width * 0.13;
  const [fx, fy] = focus ?? [SCREEN_W / 2, SCREEN_H / 2];
  // Keep the focus point centred while zoomed, without showing past the screenshot's edges.
  const tx = Math.min(0, Math.max(SCREEN_W - SCREEN_W * zoom, SCREEN_W / 2 - fx * zoom));
  const ty = Math.min(0, Math.max(SCREEN_H - SCREEN_H * zoom, SCREEN_H / 2 - fy * zoom));
  return (
    <div
      style={{
        position: "absolute",
        width,
        height,
        borderRadius: radius,
        background: "linear-gradient(145deg, #2b2938 0%, #0d0c14 45%, #1c1a27 100%)",
        boxShadow: `0 0 0 2px #3b384d, 0 40px 90px rgba(0,0,0,0.55), 0 0 140px ${glow}`,
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: bezel,
          top: bezel,
          width: innerW,
          height: innerH,
          borderRadius: radius - bezel,
          overflow: "hidden",
          background: "#000",
        }}
      >
        <div style={{ position: "absolute", width: SCREEN_W, height: SCREEN_H, transformOrigin: "0 0", transform: `scale(${k})` }}>
          <div style={{ position: "absolute", width: SCREEN_W, height: SCREEN_H, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${zoom})` }}>
            {src && <Img src={staticFile(src)} style={{ width: SCREEN_W, height: SCREEN_H, display: "block" }} />}
            {children}
          </div>
          {overlay}
        </div>
        {/* Dynamic island */}
        <div style={{ position: "absolute", top: innerH * 0.012, left: innerW / 2 - innerW * 0.15, width: innerW * 0.3, height: innerW * 0.075, borderRadius: 999, background: "#000" }} />
        {/* Glass sheen */}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(120deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 28%)", pointerEvents: "none" }} />
      </div>
    </div>
  );
}

/** Height of a Phone of the given width. */
export function phoneHeight(width: number) {
  const bezel = width * 0.035;
  return (SCREEN_H * (width - bezel * 2)) / SCREEN_W + bezel * 2;
}
