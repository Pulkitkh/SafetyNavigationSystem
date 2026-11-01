// The one timeline: scenes, narration, captions and sound effects all derive from here.
import voTiming from "./vo-timing.json";

export const FPS = 30;
export const W = 1080;
export const H = 1920;
export const f = (s: number) => Math.round(s * FPS);

/**
 * The hook: six quick lines before the story starts. Everything after it is
 * laid out on the original 95 s storyboard and shifted by D (the hook minus
 * the routine scene it replaced), so the story's internal timing is unchanged.
 */
export const HOOK = 9.4;
const D = HOOK - 6.1;
/** Frames the story moved by, for effects placed on the original storyboard. */
export const SHIFT_F = Math.round(D * FPS);

/** Scene boundaries in seconds (see SPEC.md storyboard). */
export const SCENES = {
  hook: { from: 0, to: HOOK },
  night: { from: HOOK, to: HOOK + 6.6 },
  numbers: { from: 12.7 + D, to: 23.4 + D },
  daynight: { from: 23.4 + D, to: 29.0 + D },
  fastest: { from: 29.0 + D, to: 35.4 + D },
  reveal: { from: 35.4 + D, to: 42.0 + D },
  plan: { from: 42.0 + D, to: 48.0 + D },
  checks: { from: 48.0 + D, to: 54.4 + D },
  safest: { from: 54.4 + D, to: 61.6 + D },
  live: { from: 61.6 + D, to: 66.6 + D },
  checkin: { from: 66.6 + D, to: 71.0 + D },
  sos: { from: 71.0 + D, to: 80.4 + D },
  home: { from: 80.4 + D, to: 86.2 + D },
  outro: { from: 86.2 + D, to: 95.0 + D },
} as const;
export type SceneKey = keyof typeof SCENES;
export const TOTAL_FRAMES = f(SCENES.outro.to);

/** The logo lands on a kick: the music starts exactly here, from a downbeat in the track. */
export const REVEAL_IMPACT_S = 36.0 + D;
export const BGM_TRACK_OFFSET_S = 5.462;

type Line = { id: keyof typeof voTiming; at: number; chunks: string[] };

/** Narration: start time in seconds and caption chunks (*word* = highlighted). */
export const LINES: Line[] = [
  // The hook: the routine every woman knows, one beat each.
  { id: "h01", at: 0.0, chunks: ["Keys between your fingers."] },
  { id: "h02", at: 1.5, chunks: ["A fake phone call."] },
  { id: "h03", at: 2.7, chunks: ["Walking a little faster."] },
  { id: "h04", at: 4.05, chunks: ["\"Text me when you reach.\""] },
  { id: "h05", at: 5.3, chunks: ["If you're a woman, you know this routine."] },
  { id: "h06", at: 7.7, chunks: ["You shouldn't have to."] },
  // The story
  { id: "l01", at: HOOK + 0.7, chunks: ["It's *ten at night.*", "Priya's class just ended,", "and home is a twenty-minute walk away."] },
  { id: "l03", at: 13.0 + D, chunks: ["In 2023,", "India recorded over 4 lakh,", "48 thousand *crimes against women.*"] },
  { id: "l04", at: 19.8 + D, chunks: ["That's more than *1,200*,", "*every single day.*"] },
  { id: "l05", at: 23.7 + D, chunks: ["Most women feel safe *during the day.*", "*After dark,*", "fewer than half do."] },
  { id: "l06", at: 29.3 + D, chunks: ["And the maps we rely on", "show us the *fastest* route.", "Not the *safest* one."] },
  { id: "l07", at: 36.3 + D, chunks: ["So we built *SafeNav.*"] },
  { id: "l08", at: 38.6 + D, chunks: ["Navigation that puts", "*your safety first.*"] },
  { id: "l09", at: 42.3 + D, chunks: ["Priya enters where she's going,", "and SafeNav checks *every street* on the way."] },
  { id: "l10", at: 48.2 + D, chunks: ["*Street lights.*", "*Open shops.*", "*Footpaths.*", "*Police nearby.*", "Even the *time of night.*"] },
  { id: "l11", at: 54.6 + D, chunks: ["Then it finds the *safest way home,*", "even if it takes a few minutes longer,", "and shows her *exactly why.*"] },
  { id: "l12", at: 61.8 + D, chunks: ["She starts her journey,", "and her mother can *follow her live,* all the way."] },
  { id: "l13", at: 66.8 + D, chunks: ["If she stops, or strays from the route,", "SafeNav *checks in.*"] },
  { id: "l14", at: 71.2 + D, chunks: ["And if something ever feels wrong,", "one long press on *SOS*", "alerts her trusted contacts *instantly,*", "with her *live location.*"] },
  { id: "l15", at: 80.6 + D, chunks: ["Tonight,", "Priya gets *home safe.*", "And her mother sees the moment she arrives."] },
  { id: "l16", at: 86.6 + D, chunks: ["SafeNav is *free,*", "in your browser and on Android."] },
  { id: "l17", at: 90.7 + D, chunks: ["*Get home safe.*", "*Every night.*"] },
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
