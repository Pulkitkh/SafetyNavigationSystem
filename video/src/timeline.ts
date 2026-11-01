// The one timeline: scenes, narration, captions and sound effects all derive from here.
import voTiming from "./vo-timing.json";

export const FPS = 30;
export const W = 1080;
export const H = 1920;
export const f = (s: number) => Math.round(s * FPS);

/** Scene boundaries in seconds (see SPEC.md storyboard). */
export const SCENES = {
  night: { from: 0, to: 6.6 },
  routine: { from: 6.6, to: 12.7 },
  numbers: { from: 12.7, to: 23.4 },
  daynight: { from: 23.4, to: 29.0 },
  fastest: { from: 29.0, to: 35.4 },
  reveal: { from: 35.4, to: 42.0 },
  plan: { from: 42.0, to: 48.0 },
  checks: { from: 48.0, to: 54.4 },
  safest: { from: 54.4, to: 61.6 },
  live: { from: 61.6, to: 66.6 },
  checkin: { from: 66.6, to: 71.0 },
  sos: { from: 71.0, to: 80.4 },
  home: { from: 80.4, to: 86.2 },
  outro: { from: 86.2, to: 95.0 },
} as const;
export type SceneKey = keyof typeof SCENES;
export const TOTAL_FRAMES = f(SCENES.outro.to);

/** The logo lands on a kick: the music starts exactly here, from a downbeat in the track. */
export const REVEAL_IMPACT_S = 36.0;
export const BGM_TRACK_OFFSET_S = 5.462;

type Line = { id: keyof typeof voTiming; at: number; chunks: string[] };

/** Narration: start time in seconds and caption chunks (*word* = highlighted). */
export const LINES: Line[] = [
  { id: "l01", at: 0.7, chunks: ["It's *ten at night.*", "Priya's class just ended,", "and home is a twenty-minute walk away."] },
  { id: "l02", at: 6.9, chunks: ["She knows the routine.", "*Keys* in hand.", "*Phone* ready.", "A quick *text* to her mother."] },
  { id: "l03", at: 13.0, chunks: ["In 2023,", "India recorded over 4 lakh,", "48 thousand *crimes against women.*"] },
  { id: "l04", at: 19.8, chunks: ["That's more than *1,200*,", "*every single day.*"] },
  { id: "l05", at: 23.7, chunks: ["Most women feel safe *during the day.*", "*After dark,*", "fewer than half do."] },
  { id: "l06", at: 29.3, chunks: ["And the maps we rely on", "show us the *fastest* route.", "Not the *safest* one."] },
  { id: "l07", at: 36.3, chunks: ["So we built *SafeNav.*"] },
  { id: "l08", at: 38.6, chunks: ["Navigation that puts", "*your safety first.*"] },
  { id: "l09", at: 42.3, chunks: ["Priya enters where she's going,", "and SafeNav checks *every street* on the way."] },
  { id: "l10", at: 48.2, chunks: ["*Street lights.*", "*Open shops.*", "*Footpaths.*", "*Police nearby.*", "Even the *time of night.*"] },
  { id: "l11", at: 54.6, chunks: ["Then it finds the *safest way home,*", "even if it takes a few minutes longer,", "and shows her *exactly why.*"] },
  { id: "l12", at: 61.8, chunks: ["She starts her journey,", "and her mother can *follow her live,* all the way."] },
  { id: "l13", at: 66.8, chunks: ["If she stops, or strays from the route,", "SafeNav *checks in.*"] },
  { id: "l14", at: 71.2, chunks: ["And if something ever feels wrong,", "one long press on *SOS*", "alerts her trusted contacts *instantly,*", "with her *live location.*"] },
  { id: "l15", at: 80.6, chunks: ["Tonight,", "Priya gets *home safe.*", "And her mother sees the moment she arrives."] },
  { id: "l16", at: 86.6, chunks: ["SafeNav is *free,*", "in your browser and on Android."] },
  { id: "l17", at: 90.7, chunks: ["*Get home safe.*", "*Every night.*"] },
];

export interface CaptionChunk {
  text: string;
  from: number; // frame
  to: number; // frame
  line: string;
}

/**
 * Splits each line's speech span into its caption chunks. Boundaries snap to
 * the pauses measured in the voice file, so captions change where the voice
 * pauses; where no pause is near, the split is proportional to length.
 */
export function captionChunks(): CaptionChunk[] {
  const out: CaptionChunk[] = [];
  for (const line of LINES) {
    const t = voTiming[line.id] as { dur: number; onset: number; offset: number; gaps: number[][] };
    const end = t.gaps.length && t.gaps[t.gaps.length - 1][1] >= t.dur - 0.02 ? t.gaps[t.gaps.length - 1][0] : t.dur;
    const inner = t.gaps.filter((g) => g[0] > t.onset && g[0] < end - 0.05);
    const lens = line.chunks.map((c) => c.replace(/\*/g, "").length);
    const total = lens.reduce((a, b) => a + b, 0);
    const bounds: { s: number; e: number }[] = [];
    let acc = 0;
    const used = new Set<number>();
    let prevEnd = t.onset;
    for (let i = 0; i < line.chunks.length; i++) {
      acc += lens[i];
      if (i === line.chunks.length - 1) {
        bounds.push({ s: prevEnd, e: end });
        break;
      }
      const est = t.onset + ((end - t.onset) * acc) / total;
      let best = -1;
      inner.forEach((g, gi) => {
        if (used.has(gi)) return;
        const c = (g[0] + g[1]) / 2;
        if (Math.abs(c - est) < 0.6 && (best < 0 || Math.abs(c - est) < Math.abs((inner[best][0] + inner[best][1]) / 2 - est))) best = gi;
      });
      if (best >= 0) {
        used.add(best);
        bounds.push({ s: prevEnd, e: inner[best][0] });
        prevEnd = inner[best][1];
      } else {
        bounds.push({ s: prevEnd, e: est });
        prevEnd = est;
      }
    }
    line.chunks.forEach((text, i) => {
      const from = f(line.at + bounds[i].s) - 2;
      // Hold each caption into the following pause, so it never blinks off between phrases.
      const nextStart = i < line.chunks.length - 1 ? line.at + bounds[i + 1].s : line.at + end + 0.35;
      out.push({ text, from, to: f(nextStart) - 1, line: line.id });
    });
  }
  return out;
}

/** Frame at which a caption chunk of a line starts (for syncing visuals to words). */
export function chunkFrame(lineId: string, index: number): number {
  return captionChunks().filter((c) => c.line === lineId)[index].from;
}

export const sceneFrames = (k: SceneKey) => ({ from: f(SCENES[k].from), dur: f(SCENES[k].to) - f(SCENES[k].from) });

/** Frame, relative to a scene's start, at which a caption chunk begins. */
export const cue = (k: SceneKey, lineId: string, index: number) => chunkFrame(lineId, index) - f(SCENES[k].from);
