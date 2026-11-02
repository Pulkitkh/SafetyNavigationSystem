import { Audio, Sequence, staticFile } from "remotion";
import { BGM_TRACK_OFFSET_S, f, LANG, LINES, REVEAL_IMPACT_S, SHIFT_F, storyF, TOTAL_FRAMES, voTiming } from "./timeline";

// Spans (frames) where the narrator is speaking, for ducking the music under her.
const VO_SPANS = LINES.map((l) => {
  const t = voTiming[l.id];
  return [f(l.at + t.onset), f(l.at + t.dur)] as const;
});

function ducked(frame: number, base: number, duck: number) {
  // Distance in frames to the nearest speech span (0 inside one).
  let d = Infinity;
  for (const [a, b] of VO_SPANS) d = Math.min(d, frame < a ? a - frame : frame > b ? frame - b : 0);
  const k = Math.min(1, d / 8);
  return duck + (base - duck) * k;
}

/**
 * One-shot effects, in frames on the global timeline. Story effects were placed
 * on the original storyboard and move with it (SHIFT_F); the reveal is pinned to
 * the logo impact itself.
 */
const SFX_EN: { at: number; src: string; vol: number; trim?: number; len?: number; pinned?: boolean }[] = [
  // The hook: a hit on the very first frame, then one accent per cut
  { at: 0, src: "bass-hit-short", vol: 0.55 },
  { at: 44, src: "whoosh-fast", vol: 0.28 },
  { at: 46, src: "switch-tap", vol: 0.3 },
  { at: 80, src: "air-woosh-quick", vol: 0.35 },
  { at: 120, src: "whoosh-fast", vol: 0.22 },
  { at: 129, src: "pop-electric", vol: 0.3 },
  { at: 158, src: "whoosh-fast", vol: 0.22 },
  { at: 163, src: "pop-electric", vol: 0.16 },
  { at: 170, src: "pop-electric", vol: 0.16 },
  { at: 177, src: "pop-electric", vol: 0.16 },
  { at: 184, src: "pop-electric", vol: 0.16 },
  { at: 181, src: "switch-tap", vol: 0.2 },
  { at: 188, src: "switch-tap", vol: 0.2 },
  { at: 195, src: "switch-tap", vol: 0.2 },
  { at: 202, src: "switch-tap", vol: 0.2 },
  { at: 230, src: "impact-deep-whoosh", vol: 0.45 },
  // The numbers
  { at: 512 + SHIFT_F, src: "heartbeat-single", vol: 0.7 },
  { at: 664 + SHIFT_F, src: "heartbeat-single", vol: 0.75 },
  // Day and night
  { at: 782 + SHIFT_F, src: "swoosh-slow", vol: 0.18, len: 60 },
  // Fastest is not safest
  { at: 926 + SHIFT_F, src: "whoosh-fast", vol: 0.25 },
  { at: 976 + SHIFT_F, src: "glitch-static", vol: 0.28 },
  // Reveal: riser into the impact, a sparkle on the name
  { at: f(REVEAL_IMPACT_S) - f(2.6), src: "riser", vol: 0.55, pinned: true },
  { at: f(REVEAL_IMPACT_S) - 1, src: "impact-cine-big", vol: 0.75, pinned: true },
  { at: 1093 + SHIFT_F, src: "shimmer-sparkle-sweep", vol: 0.3 },
  // The app
  { at: 1254 + SHIFT_F, src: "air-woosh-quick", vol: 0.3 },
  { at: 1337 + SHIFT_F, src: "switch-tap", vol: 0.45 },
  { at: 1438 + SHIFT_F, src: "data-scan", vol: 0.22 },
  { at: 1450 + SHIFT_F, src: "pop-electric", vol: 0.2 },
  { at: 1479 + SHIFT_F, src: "pop-electric", vol: 0.2 },
  { at: 1507 + SHIFT_F, src: "pop-electric", vol: 0.2 },
  { at: 1533 + SHIFT_F, src: "pop-electric", vol: 0.2 },
  { at: 1568 + SHIFT_F, src: "pop-electric", vol: 0.2 },
  { at: 1643 + SHIFT_F, src: "zoom-air-fast", vol: 0.25 },
  { at: 1671 + SHIFT_F, src: "marker-pen-line", vol: 0.3 },
  { at: 1730 + SHIFT_F, src: "marker-pen-line", vol: 0.3 },
  { at: 1794 + SHIFT_F, src: "marker-pen-line", vol: 0.25 },
  { at: 1846 + SHIFT_F, src: "air-woosh-quick", vol: 0.25 },
  { at: 1907 + SHIFT_F, src: "pop-electric", vol: 0.22 },
  { at: 2066 + SHIFT_F, src: "bass-hit-short", vol: 0.3 },
  { at: 2078 + SHIFT_F, src: "air-woosh-quick", vol: 0.25 },
  // SOS
  { at: 2144 + SHIFT_F, src: "heartbeat-single", vol: 0.55 },
  { at: 2238 + SHIFT_F, src: "impact-deep-whoosh", vol: 0.5 },
  { at: 2256 + SHIFT_F, src: "bass-hit-short", vol: 0.4 },
  { at: 2286 + SHIFT_F, src: "bass-hit-short", vol: 0.3 },
  { at: 2357 + SHIFT_F, src: "switch-tap", vol: 0.3 },
  // Home
  { at: 2435 + SHIFT_F, src: "swoosh-slow", vol: 0.16, len: 60 },
  { at: 2508 + SHIFT_F, src: "switch-tap", vol: 0.4 },
  { at: 2523 + SHIFT_F, src: "pop-electric", vol: 0.25 },
  // Outro
  { at: 2600 + SHIFT_F, src: "shimmer-sparkle-sweep", vol: 0.25 },
  { at: 2728 + SHIFT_F, src: "bass-hit-short", vol: 0.35 },
];

// Effects follow their moment when another language stretches a scene.
const SFX = SFX_EN.map((s) => ({ ...s, at: s.pinned ? s.at : storyF(s.at) }));

export function Sound({ bgm }: { bgm: boolean }) {
  const musicFrom = f(REVEAL_IMPACT_S);
  return (
    <>
      {/* A clean, low pad under the hook and the problem; it gives way to the riser and the music. */}
      {bgm && (
        <Sequence from={0} durationInFrames={musicFrom + 10}>
          <Audio
            src={staticFile("audio/bgm/tension-pad.wav")}
            volume={(fr) => Math.min(1, (musicFrom + 10 - fr) / 70) * ducked(fr, 0.5, 0.34)}
          />
        </Sequence>
      )}
      {bgm && (
        <Sequence from={musicFrom}>
          <Audio
            src={staticFile("audio/bgm/house-vibez.mp3")}
            trimBefore={f(BGM_TRACK_OFFSET_S)}
            volume={(fr) => {
              const g = fr + musicFrom;
              const out = Math.min(1, Math.max(0, (TOTAL_FRAMES - g) / 75));
              return ducked(g, 0.2, 0.1) * out;
            }}
          />
        </Sequence>
      )}
      {LINES.map((l) => (
        <Sequence key={l.id} from={f(l.at)}>
          <Audio src={staticFile(`audio/vo/${LANG === "hi" ? "hi/" : ""}${l.id}.wav`)} volume={1} />
        </Sequence>
      ))}
      {SFX.map((s, i) => (
        <Sequence key={i} from={s.at} durationInFrames={s.len ?? 240}>
          <Audio src={staticFile(`audio/sfx/${s.src}.${s.src === "riser" ? "wav" : "mp3"}`)} volume={(fr) => s.vol * (s.len ? Math.min(1, (s.len - fr) / 15) : 1)} />
        </Sequence>
      ))}
    </>
  );
}
