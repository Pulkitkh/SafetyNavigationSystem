import { Audio, Sequence, staticFile } from "remotion";
import voTiming from "./vo-timing.json";
import { BGM_TRACK_OFFSET_S, f, LINES, REVEAL_IMPACT_S, TOTAL_FRAMES } from "./timeline";

// Spans (frames) where the narrator is speaking, for ducking the music under her.
const VO_SPANS = LINES.map((l) => {
  const t = voTiming[l.id] as { dur: number; onset: number };
  return [f(l.at + t.onset), f(l.at + t.dur)] as const;
});

function ducked(frame: number, base: number, duck: number) {
  // Distance in frames to the nearest speech span (0 inside one).
  let d = Infinity;
  for (const [a, b] of VO_SPANS) d = Math.min(d, frame < a ? a - frame : frame > b ? frame - b : 0);
  const k = Math.min(1, d / 8);
  return duck + (base - duck) * k;
}

/** One-shot effects, at frames on the global timeline (see SPEC.md). */
const SFX: { at: number; src: string; vol: number; trim?: number; len?: number }[] = [
  // The routine
  { at: 252, src: "air-woosh-quick", vol: 0.25 },
  { at: 287, src: "switch-tap", vol: 0.35 },
  { at: 355, src: "switch-tap", vol: 0.3 },
  // The numbers
  { at: 512, src: "heartbeat-single", vol: 0.7 },
  { at: 664, src: "heartbeat-single", vol: 0.75 },
  // Day and night
  { at: 782, src: "swoosh-slow", vol: 0.18, len: 60 },
  // Fastest is not safest
  { at: 926, src: "whoosh-fast", vol: 0.25 },
  { at: 976, src: "glitch-static", vol: 0.28 },
  // Reveal: riser into the impact, a sparkle on the name
  { at: f(REVEAL_IMPACT_S) - f(2.6), src: "riser", vol: 0.55 },
  { at: f(REVEAL_IMPACT_S) - 1, src: "impact-cine-big", vol: 0.75 },
  { at: 1093, src: "shimmer-sparkle-sweep", vol: 0.3 },
  // The app
  { at: 1254, src: "air-woosh-quick", vol: 0.3 },
  { at: 1337, src: "switch-tap", vol: 0.45 },
  { at: 1438, src: "data-scan", vol: 0.22 },
  { at: 1450, src: "pop-electric", vol: 0.2 },
  { at: 1479, src: "pop-electric", vol: 0.2 },
  { at: 1507, src: "pop-electric", vol: 0.2 },
  { at: 1533, src: "pop-electric", vol: 0.2 },
  { at: 1568, src: "pop-electric", vol: 0.2 },
  { at: 1643, src: "zoom-air-fast", vol: 0.25 },
  { at: 1671, src: "marker-pen-line", vol: 0.3 },
  { at: 1730, src: "marker-pen-line", vol: 0.3 },
  { at: 1794, src: "marker-pen-line", vol: 0.25 },
  { at: 1846, src: "air-woosh-quick", vol: 0.25 },
  { at: 1907, src: "pop-electric", vol: 0.22 },
  { at: 2066, src: "bass-hit-short", vol: 0.3 },
  { at: 2078, src: "air-woosh-quick", vol: 0.25 },
  // SOS
  { at: 2144, src: "heartbeat-single", vol: 0.55 },
  { at: 2238, src: "impact-deep-whoosh", vol: 0.5 },
  { at: 2256, src: "bass-hit-short", vol: 0.4 },
  { at: 2286, src: "bass-hit-short", vol: 0.3 },
  { at: 2357, src: "switch-tap", vol: 0.3 },
  // Home
  { at: 2435, src: "swoosh-slow", vol: 0.16, len: 60 },
  { at: 2508, src: "switch-tap", vol: 0.4 },
  { at: 2523, src: "pop-electric", vol: 0.25 },
  // Outro
  { at: 2600, src: "shimmer-sparkle-sweep", vol: 0.25 },
  { at: 2728, src: "bass-hit-short", vol: 0.35 },
];

export function Sound({ bgm }: { bgm: boolean }) {
  const musicFrom = f(REVEAL_IMPACT_S);
  return (
    <>
      {/* Night street ambience under the problem, gone as the music hits */}
      <Sequence from={0} durationInFrames={musicFrom + 20}>
        <Audio
          src={staticFile("audio/bgm/night-ambience.wav")}
          volume={(fr) => Math.min(1, fr / 20) * Math.min(1, (musicFrom + 20 - fr) / 40) * ducked(fr, 0.55, 0.38)}
        />
      </Sequence>
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
          <Audio src={staticFile(`audio/vo/${l.id}.wav`)} volume={1} />
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
