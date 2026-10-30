/**
 * "What's around me": the area check (area.ts) run on a grid of blocks within
 * about a kilometre, now and after dark, so the app can point out nearby
 * stretches to avoid and busier, better-lit places to head for, and show how
 * the spot itself changes through the day. Blocks with too little map data
 * are reported as such and never listed as safe or unsafe.
 */
import { bearing, destinationPoint, haversine, type LngLat } from "@/lib/geo";
import { atLocalTime, isDark, lightPeriod, type LightPeriod } from "@/lib/time";
import { scoreArea, type AreaContext } from "./area";
import type { ConfidenceLevel, FeatureIndex } from "./score";

export const SCAN_RADIUS_M = 1000;
const SPACING_M = 250;

export interface BlockScore {
  score: number;
  band: "good" | "caution" | "avoid";
  range: { lo: number; hi: number };
  confidence: ConfidenceLevel;
  reasons: string[];
  highlights: string[];
}

export interface Block {
  center: LngLat;
  distance: number;
  direction: string;
  /** Neighbourhood or main street the block is in or on, when mapped. */
  name: string | null;
  now: BlockScore;
  /** The same block at 9:30 pm, when the scan runs in daylight. */
  night: BlockScore | null;
}

export interface Pointer {
  /** Neighbourhood or street, or the distance and direction when the block has no mapped name. */
  name: string;
  named: boolean;
  center: LngLat;
  distance: number;
  direction: string;
  score: number;
  when: "now" | "after dark";
  reasons: string[];
}

export interface ProfilePoint {
  label: string;
  at: string;
  period: LightPeriod;
  score: number;
  band: BlockScore["band"];
  confidence: ConfidenceLevel;
}

export interface LocalityScan {
  at: string;
  place: string | null;
  /** How this spot changes through the day. */
  profile: ProfilePoint[];
  blocks: Block[];
  /** Nearby stretches to stay away from, worst first. */
  avoid: Pointer[];
  /** Nearby places that score well, best first: busier and better lit. */
  safer: Pointer[];
  /** Share of blocks with too little data to score. */
  unscoredShare: number;
  notes: string[];
}

const DIRS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const direction = (from: LngLat, to: LngLat) => DIRS[Math.round((((bearing(from, to) % 360) + 360) % 360) / 45) % 8];

/** Block centres on a hexagonal grid within `radiusM`. */
export function blockCenters(center: LngLat, radiusM = SCAN_RADIUS_M, spacingM = SPACING_M): LngLat[] {
  const out: LngLat[] = [];
  const rows = Math.ceil(radiusM / (spacingM * 0.866));
  for (let r = -rows; r <= rows; r++) {
    const y = r * spacingM * 0.866;
    const shift = r % 2 ? spacingM / 2 : 0;
    const cols = Math.ceil(radiusM / spacingM) + 1;
    for (let c = -cols; c <= cols; c++) {
      const x = c * spacingM + shift;
      const d = Math.hypot(x, y);
      if (d > radiusM) continue;
      const p = d === 0 ? center : destinationPoint(center, (Math.atan2(x, y) * 180) / Math.PI, d);
      out.push(p);
    }
  }
  return out;
}

function summarise(a: ReturnType<typeof scoreArea>): BlockScore {
  return { score: a.score, band: a.band, range: a.range, confidence: a.confidence, reasons: a.reasons, highlights: a.highlights };
}

/** A name people would recognise for a block: its neighbourhood, else the main street it's on. */
function blockName(index: FeatureIndex, p: LngLat): string | null {
  const road = index.nearestRoad(p, 80)?.road;
  const street = road?.tags.name && /^(trunk|primary|secondary|tertiary|residential|unclassified|pedestrian)/.test(road.tags.highway ?? "") ? road.tags.name : null;
  const place = index.placeNear(p, 700)?.place.name ?? null;
  if (place && street) return `${street}, ${place}`;
  return place ?? street;
}

export function scanLocality(center: LngLat, index: FeatureIndex, ctx: AreaContext): LocalityScan {
  const nowPeriod = lightPeriod(ctx.at, center[1], center[0], ctx.tz);
  const nightAt = isDark(nowPeriod) ? null : atLocalTime(ctx.at, 21, 30, ctx.tz);
  const blocks: Block[] = [];
  let unscored = 0;
  for (const p of blockCenters(center)) {
    // Fields, water and large closed campuses have no streets to walk; leave them out.
    if (!index.nearestRoad(p, 120)) continue;
    const now = summarise(scoreArea(p, index, ctx));
    const night = nightAt ? summarise(scoreArea(p, index, { ...ctx, at: nightAt, raining: false, foggy: false })) : null;
    if (now.confidence === "insufficient") unscored++;
    const distance = Math.round(haversine(center, p));
    blocks.push({ center: p, distance, direction: distance < 60 ? "here" : direction(center, p), name: blockName(index, p), now, night });
  }

  // Pointers: worst and best blocks, one per name, skipping blocks the data can't speak for.
  const named = (b: Block) => b.name ?? (b.distance < 60 ? "Right here" : `Streets ${Math.round(b.distance / 50) * 50} m ${b.direction}`);
  const pointer = (b: Block, s: BlockScore, when: Pointer["when"], list: "reasons" | "highlights"): Pointer => ({
    name: named(b),
    named: !!b.name,
    center: b.center,
    distance: b.distance,
    direction: b.direction,
    score: s.score,
    when,
    reasons: s[list].slice(0, 3),
  });
  const reliable = (s: BlockScore | null): s is BlockScore => !!s && (s.confidence === "high" || s.confidence === "medium" || s.confidence === "low");
  const avoidCandidates = blocks
    .flatMap((b) => {
      const out: Pointer[] = [];
      if (reliable(b.now) && b.now.range.hi < 55 && b.now.score < 50) out.push(pointer(b, b.now, "now", "reasons"));
      else if (reliable(b.night) && b.night.range.hi < 55 && b.night.score < 50) out.push(pointer(b, b.night, "after dark", "reasons"));
      return out;
    })
    .sort((a, b) => a.score - b.score);
  const saferCandidates = blocks
    .filter((b) => reliable(b.now) && b.now.range.lo >= 60 && b.now.score >= 68 && b.distance >= 60)
    .map((b) => pointer(b, b.now, "now", "highlights"))
    .sort((a, b) => b.score - a.score || a.distance - b.distance);
  const onePerName = (list: Pointer[], n: number) => {
    const seen = new Set<string>();
    return list.filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true))).slice(0, n);
  };

  // The spot itself through the day.
  const profile: ProfilePoint[] = [
    { label: "Morning", h: 8, m: 0 },
    { label: "Afternoon", h: 14, m: 0 },
    { label: "Evening", h: 19, m: 0 },
    { label: "Night", h: 21, m: 30 },
    { label: "Late night", h: 23, m: 30 },
  ].map(({ label, h, m }) => {
    const at = atLocalTime(ctx.at, h, m, ctx.tz);
    const a = scoreArea(center, index, { ...ctx, at, raining: false, foggy: false });
    return { label, at: at.toISOString(), period: a.period, score: a.score, band: a.band, confidence: a.confidence };
  });

  const notes: string[] = [];
  const unscoredShare = blocks.length ? unscored / blocks.length : 1;
  if (!blocks.length) notes.push("No mapped streets were found around this spot.");
  else if (unscoredShare > 0.5) notes.push("Map data around here is too thin to compare most nearby streets. The places marked grey couldn't be scored.");
  if (index.source === "tiles" || index.tileBoxes.length) notes.push("Detailed street data was unavailable for part of this area, so those streets use the map's base data.");

  return {
    at: ctx.at.toISOString(),
    place: index.placeNear(center, 1200)?.place.name ?? null,
    profile,
    blocks,
    avoid: onePerName(avoidCandidates, 4),
    safer: onePerName(saferCandidates, 3),
    unscoredShare: Math.round(unscoredShare * 100) / 100,
    notes,
  };
}
