import { AbsoluteFill, interpolate } from "remotion";
import { useT } from "../components/Scene";
import { Priya } from "../components/Priya";
import { rand } from "../util";
import { C, EASE_IN_OUT } from "../theme";

const GROUND = 1500;

function Skyline({ offset, seed, color, minH, maxH, windows, y }: { offset: number; seed: number; color: string; minH: number; maxH: number; windows: number; y: number }) {
  const blocks: { x: number; w: number; h: number; i: number }[] = [];
  let x = -200;
  for (let i = 0; x < 4200; i++) {
    const w = 140 + rand(seed + i) * 180;
    blocks.push({ x, w, h: minH + rand(seed + i * 7) * (maxH - minH), i });
    x += w + 6;
  }
  const span = 4200;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1920 }}>
      {blocks.map((b) => {
        const bx = ((((b.x - offset) % span) + span) % span) - 200;
        return (
          <div key={b.i} style={{ position: "absolute", left: bx, top: y - b.h, width: b.w, height: b.h, background: color }}>
            {Array.from({ length: windows }).map((_, k) => {
              const r = rand(seed * 31 + b.i * 13 + k);
              if (r > 0.32) return null;
              const cols = Math.max(2, Math.floor(b.w / 46));
              const col = k % cols;
              const row = Math.floor(k / cols);
              if (24 + row * 58 > b.h - 40) return null;
              return (
                <div
                  key={k}
                  style={{ position: "absolute", left: 16 + col * 46, top: 24 + row * 58, width: 22, height: 30, background: C.lamp, opacity: 0.18 + r * 0.9, borderRadius: 2 }}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Shopfronts at street level, shutters down for the night. */
function Shops({ offset }: { offset: number }) {
  const span = 3600;
  return (
    <>
      {Array.from({ length: 9 }).map((_, i) => {
        const x = ((((i * 400 - offset) % span) + span) % span) - 300;
        const open = i === 6; // one small tea stall still open, far ahead
        return (
          <div key={i} style={{ position: "absolute", left: x, top: GROUND - 230, width: 340, height: 230, background: "#0a0915" }}>
            <div
              style={{
                position: "absolute",
                left: 24,
                right: 24,
                top: 46,
                bottom: 0,
                background: open
                  ? "linear-gradient(#ffcf7a55, #ffcf7a22)"
                  : "repeating-linear-gradient(#171529 0 9px, #100e1f 9px 18px)",
                boxShadow: open ? "0 0 60px #ffcf7a55" : undefined,
              }}
            />
            <div style={{ position: "absolute", left: 24, right: 24, top: 18, height: 20, background: "#120f24" }} />
          </div>
        );
      })}
    </>
  );
}

function Lamps({ offset, frame }: { offset: number; frame: number }) {
  const span = 2400;
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => {
        const x = ((((i * 600 + 200 - offset) % span) + span) % span) - 300;
        // One lamp flickers, one is dead: dark stretches are part of the walk.
        const state = i === 1 ? "flicker" : i === 3 ? "dead" : "lit";
        const flick = state === "flicker" ? (rand(Math.floor(frame / 3) * 7 + 3) > 0.45 ? 1 : 0.15) : 1;
        const on = state === "dead" ? 0 : flick;
        return (
          <div key={i} style={{ position: "absolute", left: x, top: 0 }}>
            {/* Light pool: the gradient reaches zero inside its box, so no edge shows */}
            <div
              style={{
                position: "absolute",
                left: -272,
                top: GROUND - 1001,
                width: 700,
                height: 900,
                background: `radial-gradient(ellipse 44% 40% at 50% 45%, rgba(255,207,122,${0.3 * on}) 0%, rgba(255,207,122,${0.12 * on}) 45%, rgba(255,207,122,0) 100%)`,
              }}
            />
            <div style={{ position: "absolute", left: -140, top: GROUND - 30, width: 380, height: 90, borderRadius: "50%", background: `radial-gradient(ellipse at center, rgba(255,207,122,${0.22 * on}) 0%, rgba(255,207,122,0) 70%)` }} />
            <div style={{ position: "absolute", left: 0, top: GROUND - 600, width: 10, height: 600, background: "#16142a" }} />
            <div style={{ position: "absolute", left: 0, top: GROUND - 604, width: 80, height: 10, background: "#16142a", borderRadius: 4 }} />
            <div
              style={{
                position: "absolute",
                left: 56,
                top: GROUND - 596,
                width: 44,
                height: 14,
                borderRadius: "0 0 22px 22px",
                background: on ? C.lamp : "#2a2740",
                opacity: 0.3 + 0.7 * on,
                boxShadow: on ? `0 8px 50px rgba(255,207,122,${0.8 * on})` : undefined,
              }}
            />
          </div>
        );
      })}
    </>
  );
}

/** Scene 1: 10 pm, Priya walks home past shuttered shops and uneven street lights. */
export function NightStreet({ dur, speed = 1 }: { dur: number; speed?: number }) {
  const frame = useT();
  const walked = frame * 3.2 * speed; // px per frame at street level
  const push = interpolate(frame, [0, dur], [1, 1.07], { easing: EASE_IN_OUT });
  return (
    <AbsoluteFill style={{ background: `linear-gradient(${C.skyTop} 0%, #110d2b 55%, ${C.skyBottom} 78%)`, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: "540px 1150px" }}>
        {/* Stars */}
        {Array.from({ length: 70 }).map((_, i) => {
          const tw = 0.4 + 0.6 * Math.abs(Math.sin(frame / 18 + i));
          return (
            <div
              key={i}
              style={{ position: "absolute", left: rand(i * 3) * 1080, top: 120 + rand(i * 5 + 1) * 700, width: 3, height: 3, borderRadius: 2, background: "#fff", opacity: 0.15 + 0.5 * tw * rand(i * 11) }}
            />
          );
        })}
        {/* Moon */}
        {/* Crescent moon: a shadow offset from a transparent disc, plus a soft halo */}
        <div style={{ position: "absolute", left: 730, top: 440, width: 180, height: 180, borderRadius: 90, background: "radial-gradient(circle, rgba(244,239,224,0.16) 0%, rgba(244,239,224,0) 70%)" }} />
        <div style={{ position: "absolute", left: 770, top: 470, width: 110, height: 110, borderRadius: 55, boxShadow: "-26px 10px 0 0 #f4efe0", filter: "drop-shadow(0 0 18px rgba(244,239,224,0.5))" }} />
        <Skyline offset={walked * 0.18} seed={11} color="#151231" minH={260} maxH={620} windows={40} y={GROUND - 120} />
        <Skyline offset={walked * 0.45} seed={47} color="#0d0b1e" minH={340} maxH={760} windows={60} y={GROUND - 60} />
        <Shops offset={walked * 0.8} />
        <Lamps offset={walked} frame={frame} />
        {/* Pavement and road */}
        <div style={{ position: "absolute", left: 0, top: GROUND, width: 1080, height: 70, background: "#17152b" }} />
        <div style={{ position: "absolute", left: 0, top: GROUND + 70, width: 1080, height: 360, background: "#09080f" }} />
        {Array.from({ length: 8 }).map((_, i) => {
          const x = ((((i * 260 - walked * 1.25) % 2080) + 2080) % 2080) - 200;
          return <div key={i} style={{ position: "absolute", left: x, top: GROUND + 220, width: 120, height: 10, background: "#2a2740", borderRadius: 5 }} />;
        })}
        {/* Priya */}
        <div style={{ position: "absolute", left: 330, top: GROUND - 640 + 20, width: 252, height: 640 }}>
          <Priya phase={((frame * speed) / 34) * 2 * Math.PI} />
        </div>
        {/* Her shadow on the pavement */}
        <div style={{ position: "absolute", left: 370, top: GROUND + 14, width: 230, height: 22, borderRadius: "50%", background: "rgba(0,0,0,0.55)", filter: "blur(6px)" }} />
      </AbsoluteFill>
      {/* Vignette */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 80% 70% at 50% 55%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.65) 100%)" }} />
    </AbsoluteFill>
  );
}
