/**
 * Route safety model.
 *
 * The factors follow two established frameworks for pedestrian safety:
 *  - Safetipin's audit parameters, used by Indian city governments
 *    (lighting, openness, visibility, people, security, walk path, public transport);
 *  - CPTED (Crime Prevention Through Environmental Design): natural surveillance
 *    ("eyes on the street"), territoriality and access to help.
 *
 * Each 100 m stretch of a route gets seven factor scores (0–100, higher is safer)
 * computed from OpenStreetMap data, the time of travel and community reports.
 * Factor weights change with light conditions: lighting carries no weight in
 * daylight and the most weight late at night.
 *
 * The constants below are a transparent heuristic, not a trained model. They are
 * documented in docs/SAFETY_MODEL.md and kept in one place so they can be tuned.
 *
 * Unknown is never scored as safe. Where an input isn't mapped (lighting on most
 * Indian streets, footpaths along many main roads, shops in some areas) the
 * score uses a conservative prior, and the input's plausible range is carried
 * through, so each score comes with a range and a statement of how much rests
 * on estimates. Routes are ranked on the pessimistic side of that range.
 */
import OpeningHours from "opening_hours";
import {
  GridIndex,
  distanceToBBox,
  haversine,
  inBBox,
  bboxOf,
  pointInPolygon,
  pointToSegment,
  resample,
  type BBox,
  type LngLat,
} from "@/lib/geo";
import type { Area, AreaKind, OsmFeatures, Place, Poi, PoiKind, Road } from "@/lib/providers/overpass";
import { REPORT_MAX_AGE_DAYS, reportCategory } from "@/lib/reports";
import { isDark, lightPeriod, wallClockDate, wallParts, type LightPeriod } from "@/lib/time";

import { FACTORS, type Factor } from "./factors";
export { FACTORS, FACTOR_LABELS, type Factor } from "./factors";

export const WEIGHTS: Record<LightPeriod, Record<Factor, number>> = {
  day: { lighting: 0, activity: 0.18, frontage: 0.07, walkpath: 0.23, isolation: 0.11, help: 0.1, transit: 0.06, community: 0.25 },
  twilight: { lighting: 0.14, activity: 0.18, frontage: 0.07, walkpath: 0.16, isolation: 0.12, help: 0.09, transit: 0.06, community: 0.18 },
  night: { lighting: 0.22, activity: 0.18, frontage: 0.08, walkpath: 0.09, isolation: 0.13, help: 0.09, transit: 0.05, community: 0.16 },
  late_night: { lighting: 0.22, activity: 0.22, frontage: 0.08, walkpath: 0.05, isolation: 0.14, help: 0.1, transit: 0.03, community: 0.16 },
};

const SAMPLE_STEP_M = 20;
const SEGMENT_M = 100;

export interface CommunityReport {
  id: string;
  category: string;
  point: LngLat;
  observedAt: Date;
  upvotes: number;
  flags: number;
}

export interface ScoringContext {
  departAt: Date;
  tz: string;
  raining?: boolean;
  /** ≥ 4 mm/h or thunderstorm at the time of travel. */
  heavyRain?: boolean;
  /** Visibility under 1 km at the time of travel. */
  foggy?: boolean;
  /** Wheelchair, walker, stroller or anyone who cannot use steps. */
  stepFree?: boolean;
}

export interface ScoredSegment {
  from: number;
  to: number;
  coordinates: LngLat[];
  score: number;
  /** Plausible range of the score given what's unmapped here. */
  lo?: number;
  hi?: number;
  factors: Record<Factor, number>;
  reasons: string[];
}

export interface WeakStretch {
  from: number;
  to: number;
  length: number;
  score: number;
  center: LngLat;
  reasons: string[];
}

export type ConfidenceLevel = "high" | "medium" | "low" | "insufficient";

export interface RouteSafety {
  score: number;
  band: "good" | "caution" | "avoid";
  period: LightPeriod;
  factors: Record<Factor, number>;
  weights: Record<Factor, number>;
  segments: ScoredSegment[];
  weakStretches: WeakStretch[];
  highlights: string[];
  /**
   * How far the score rests on mapped facts. "insufficient": too little is
   * mapped to give a score; the app says so instead of showing one.
   */
  confidence: { level: ConfidenceLevel; coverage: number; notes: string[] };
  /** The score if every unmapped input were at its worst / best plausible value. */
  range: { lo: number; hi: number };
  /** Ranking score: halfway between the score and its pessimistic end, so a route doesn't win on unknowns. */
  conservative: number;
  stats: {
    litShare: number | null;
    footpathShare: number;
    openPlaces: number;
    nearestPoliceM: number | null;
    cctv: number;
    reportsNearby: number;
    /** Distinct flights of steps the route uses. */
    steps: number;
    /** Share of the route matched to a mapped street or path. */
    matchedShare: number;
    /** Share of the route scored from the lighter vector-tile data. */
    tilesShare: number;
  };
}

// ---------------------------------------------------------------------------
// Feature index
// ---------------------------------------------------------------------------

interface RoadSegmentRef {
  road: Road;
  i: number;
}

export interface IndexOptions {
  /** Parts of the area filled from vector tiles rather than Overpass. */
  tileBoxes?: BBox[];
}

export class FeatureIndex {
  readonly roads = new GridIndex<RoadSegmentRef>(60);
  readonly pois = new GridIndex<Poi>(120);
  readonly reports = new GridIndex<CommunityReport>(120);
  readonly buildings = new GridIndex<BBox>(60);
  readonly places = new GridIndex<Place>(400);
  readonly buildingCount: number;
  readonly source: "overpass" | "tiles";
  readonly areas: { area: Area; bbox: BBox }[];
  readonly tileBoxes: BBox[];
  /**
   * Shops and eateries look under-mapped: many buildings but almost no places,
   * so "few shops around" may be a mapping gap rather than a fact.
   */
  readonly placesSparse: boolean;
  private readonly ohCache = new Map<string, OpeningHours | null>();
  private readonly areaGrid = new GridIndex<number>(150);
  private readonly largeAreas: number[] = [];

  constructor(features: OsmFeatures, reports: CommunityReport[], opts: IndexOptions = {}) {
    for (const road of features.roads) {
      for (let i = 0; i < road.geometry.length - 1; i++) {
        const a = road.geometry[i];
        const b = road.geometry[i + 1];
        const len = haversine(a, b);
        const steps = Math.max(1, Math.ceil(len / 30));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          this.roads.insert([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], { road, i });
        }
      }
    }
    for (const poi of features.pois) this.pois.insert(poi.point, poi);
    for (const r of reports) this.reports.insert(r.point, r);
    // Index each footprint at its corners and centre so large blocks are found from any side.
    for (const b of features.buildings ?? []) {
      const pts: LngLat[] = [
        [(b.minLng + b.maxLng) / 2, (b.minLat + b.maxLat) / 2],
        [b.minLng, b.minLat],
        [b.minLng, b.maxLat],
        [b.maxLng, b.minLat],
        [b.maxLng, b.maxLat],
      ];
      for (const p of pts) this.buildings.insert(p, b);
    }
    this.buildingCount = features.buildings?.length ?? 0;
    this.source = features.source ?? "overpass";
    this.areas = features.areas.map((area) => ({ area, bbox: bboxOf(area.ring) }));
    // Index each land-use area by the grid cells its bounds cover, so a point only tests nearby polygons.
    this.areas.forEach(({ bbox }, i) => {
      const step = 0.001;
      const n = Math.ceil((bbox.maxLng - bbox.minLng) / step + 1) * Math.ceil((bbox.maxLat - bbox.minLat) / step + 1);
      if (n > 40_000) return void this.largeAreas.push(i);
      for (let lng = bbox.minLng; lng <= bbox.maxLng + step; lng += step) {
        for (let lat = bbox.minLat; lat <= bbox.maxLat + step; lat += step) this.areaGrid.insert([lng, lat], i);
      }
    });
    for (const p of features.places ?? []) this.places.insert(p.point, p);
    this.tileBoxes = opts.tileBoxes ?? [];
    const activityPois = features.pois.filter((p) => ACTIVITY_WEIGHT[p.kind] != null && p.kind !== "transit").length;
    const roadKm = features.roads.reduce((a, r) => a + (r.geometry.length > 1 ? haversine(r.geometry[0], r.geometry.at(-1)!) : 0), 0) / 1000;
    this.placesSparse = (this.buildingCount >= 300 && activityPois / this.buildingCount < 0.004) || (activityPois < 3 && roadKm > 5);
  }

  /** Whether `p` lies in a part filled from vector tiles. */
  fromTiles(p: LngLat): boolean {
    if (this.source === "tiles") return true;
    return this.tileBoxes.some((b) => inBBox(p, b));
  }

  /** Nearest named neighbourhood, suburb or village within `maxM`. */
  placeNear(p: LngLat, maxM = 1500): { place: Place; distance: number } | null {
    let best: { place: Place; distance: number } | null = null;
    for (const { item, distance } of this.places.near(p, maxM)) if (!best || distance < best.distance) best = { place: item, distance };
    return best;
  }

  /** Closest mapped road or path to `p`, if one lies within `maxM`. */
  nearestRoad(p: LngLat, maxM = 25): { road: Road; distance: number } | null {
    let best: { road: Road; distance: number } | null = null;
    const checked = new Set<string>();
    for (const { item } of this.roads.near(p, maxM + 30)) {
      const key = `${item.road.id}:${item.i}`;
      if (checked.has(key)) continue;
      checked.add(key);
      const { distance } = pointToSegment(p, item.road.geometry[item.i], item.road.geometry[item.i + 1]);
      if (distance <= maxM && (!best || distance < best.distance)) best = { road: item.road, distance };
    }
    return best;
  }

  areasAt(p: LngLat): AreaKind[] {
    const out: AreaKind[] = [];
    const tested = new Set<number>();
    const test = (i: number) => {
      if (tested.has(i)) return;
      tested.add(i);
      const { area, bbox } = this.areas[i];
      if (inBBox(p, bbox) && pointInPolygon(p, area.ring)) out.push(area.kind);
    };
    for (const { item } of this.areaGrid.near(p, 160)) test(item);
    // Very large areas (a forest, an airport) are tested directly.
    for (const i of this.largeAreas) test(i);
    return out;
  }

  openingHours(value: string): OpeningHours | null {
    if (this.ohCache.has(value)) return this.ohCache.get(value)!;
    let parsed: OpeningHours | null = null;
    try {
      parsed = new OpeningHours(value, null, 0);
    } catch {
      parsed = null;
    }
    this.ohCache.set(value, parsed);
    return parsed;
  }
}

// ---------------------------------------------------------------------------
// Factor functions (pure, exported for tests)
// ---------------------------------------------------------------------------

const MAJOR = new Set(["trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"]);
const MINOR_ROADS = new Set(["residential", "unclassified", "living_street", "service", "road"]);
const PEDESTRIAN = new Set(["footway", "pedestrian", "living_street"]);
const LIT_YES = new Set(["yes", "24/7", "automatic", "sunset-sunrise", "dusk-dawn"]);

export function lightingPrior(highway: string | undefined): number {
  if (!highway) return 40;
  if (MAJOR.has(highway)) return 70;
  if (highway === "tertiary" || highway === "tertiary_link") return 60;
  if (highway === "pedestrian") return 60;
  if (highway === "residential" || highway === "unclassified" || highway === "living_street") return 45;
  if (highway === "service") return 35;
  if (highway === "track" || highway === "bridleway") return 10;
  return 35; // footway, path, steps, cycleway
}

/** Lighting of one sample point; `known` is false when it rests on the prior. */
export function lightingScore(tags: Record<string, string> | undefined, lampsNearby: number): { score: number; known: boolean } {
  const lit = tags?.lit;
  if (lit && (LIT_YES.has(lit) || /^\d/.test(lit))) return { score: 100, known: true };
  if (lit === "limited" || lit === "interval") return { score: 60, known: true };
  if (lit === "no" || lit === "disused") return { score: lampsNearby > 0 ? 55 : 10, known: true };
  if (lampsNearby >= 2) return { score: 90, known: true };
  if (lampsNearby === 1) return { score: 75, known: true };
  return { score: lightingPrior(tags?.highway), known: false };
}

function hasSidewalk(tags: Record<string, string>): boolean | null {
  const values = [tags.sidewalk, tags["sidewalk:both"], tags["sidewalk:left"], tags["sidewalk:right"]].filter(Boolean);
  if (!values.length) return null;
  return values.some((v) => ["both", "left", "right", "separate", "yes"].includes(v!));
}

const UNPAVED = new Set(["unpaved", "gravel", "fine_gravel", "dirt", "earth", "ground", "grass", "mud", "sand", "pebblestone", "rock", "woodchips"]);

export interface WalkOptions {
  stepFree?: boolean;
  heavyRain?: boolean;
}

export function walkpathScore(
  tags: Record<string, string> | undefined,
  dark: boolean,
  opts: WalkOptions = {},
): { score: number; known: boolean; reason?: string } {
  const base = baseWalkpath(tags, dark, opts);
  if (!opts.stepFree || !tags?.highway) return base;
  // Step-free travel: steps, unpaved ground and ways mapped as inaccessible are near-impassable.
  if (tags.highway === "steps") return { score: 5, known: true, reason: "Steps (not step-free)" };
  if (tags.wheelchair === "no") return { score: 15, known: true, reason: "Mapped as not wheelchair accessible" };
  if (tags.surface && UNPAVED.has(tags.surface)) return { score: Math.min(base.score, 30), known: true, reason: "Unpaved surface" };
  if (tags.smoothness && ["bad", "very_bad", "horrible", "very_horrible", "impassable"].includes(tags.smoothness)) {
    return { score: Math.min(base.score, 35), known: true, reason: "Rough surface" };
  }
  if (tags.wheelchair === "yes") return { ...base, score: Math.max(base.score, 85), known: true };
  return base;
}

function baseWalkpath(tags: Record<string, string> | undefined, dark: boolean, opts: WalkOptions): { score: number; known: boolean; reason?: string } {
  if (!tags?.highway) return { score: 55, known: false };
  const hw = tags.highway;
  if (tags.tunnel === "yes" && (hw === "footway" || hw === "path" || hw === "steps")) {
    // Pedestrian subways in Indian cities flood quickly in monsoon downpours.
    if (opts.heavyRain) return { score: 20, known: true, reason: "Underpass may be waterlogged in heavy rain" };
    return { score: dark ? 30 : 60, known: true, reason: "Pedestrian underpass" };
  }
  // Foot overbridges are often empty after dark, with nowhere to go but the far end.
  if (tags.bridge && tags.bridge !== "no" && (hw === "footway" || hw === "path" || hw === "steps")) {
    return dark ? { score: 45, known: true, reason: "Foot overbridge, often empty after dark" } : { score: 75, known: true };
  }
  if (PEDESTRIAN.has(hw)) return { score: 90, known: true };
  if (hw === "cycleway") return { score: 75, known: true };
  if (hw === "steps") return dark ? { score: 50, known: true, reason: "Stairway, little natural surveillance after dark" } : { score: 65, known: true };
  if (hw === "path") return { score: dark ? 45 : 60, known: true };
  if (hw === "track" || hw === "bridleway") return { score: dark ? 25 : 40, known: true, reason: "Unpaved track" };
  const isMajor = MAJOR.has(hw) || hw === "tertiary" || hw === "tertiary_link";
  if (isMajor) {
    const sw = hasSidewalk(tags);
    // Walking beside fast, wide traffic with no footpath is the most dangerous case.
    const fast = Number.parseInt(tags.maxspeed ?? "", 10) >= 60 || Number.parseInt(tags.lanes ?? "", 10) >= 4;
    if (sw === true) return { score: 85, known: true };
    if (sw === false) return fast ? { score: 15, known: true, reason: "Fast, wide road without a footpath" } : { score: 25, known: true, reason: "No footpath along a busy road" };
    const prior = hw.startsWith("trunk") ? 35 : hw.startsWith("primary") ? 50 : hw.startsWith("secondary") ? 55 : 60;
    return { score: fast ? prior - 10 : prior, known: false };
  }
  // Narrow back lanes have little natural surveillance after dark (CPTED).
  if (hw === "service" && tags.service === "alley" && dark) return { score: 40, known: true, reason: "Narrow back lane" };
  if (MINOR_ROADS.has(hw)) return { score: 70, known: true };
  return { score: 55, known: false };
}

export const AREA_PENALTY: Record<AreaKind, { dark: number; light: number; label: string }> = {
  industrial: { dark: 70, light: 35, label: "an industrial area" },
  cemetery: { dark: 75, light: 30, label: "a cemetery" },
  woods: { dark: 75, light: 45, label: "wooded or scrub land" },
  park: { dark: 55, light: 10, label: "a park" },
  wasteland: { dark: 65, light: 35, label: "vacant or waste land" },
  construction: { dark: 65, light: 35, label: "a construction site" },
  railway: { dark: 50, light: 25, label: "a railway corridor" },
  military: { dark: 40, light: 20, label: "a restricted area" },
};

export function isolationScore(kinds: AreaKind[], period: LightPeriod): { score: number; worst?: AreaKind } {
  let worst: AreaKind | undefined;
  let penalty = 0;
  for (const k of kinds) {
    const p = AREA_PENALTY[k];
    const value = period === "day" ? p.light : period === "twilight" ? (p.light + p.dark) / 2 : p.dark;
    if (value > penalty) {
      penalty = value;
      worst = k;
    }
  }
  return { score: 100 - penalty, worst };
}

export const ACTIVITY_WEIGHT: Partial<Record<PoiKind, number>> = {
  shop: 1,
  food: 1.2,
  venue: 1.5,
  pharmacy: 1,
  clinic: 0.7,
  fuel: 1.2,
  bank: 0.6,
  atm: 0.2,
  worship: 0.6,
  hospital: 1,
  transit: 0.3,
};

/**
 * Probability that a place without usable opening_hours is open at a given local
 * hour, based on typical Indian urban trading hours.
 */
export function defaultOpenProbability(kind: PoiKind, hour: number): number {
  switch (kind) {
    case "hospital":
    case "atm":
    case "police": // police stations in India are staffed round the clock
      return 1;
    case "transit":
      // City buses and metros mostly stop around 23:00 and restart near 05:30,
      // so a stop brings people only while services run.
      if (hour >= 6 && hour < 22) return 1;
      if (hour >= 22 && hour < 23) return 0.6;
      return 0.1;
    case "fuel":
      return hour >= 6 && hour < 22 ? 0.9 : 0.45;
    case "bank":
      return hour >= 10 && hour < 16 ? 0.8 : 0;
    case "worship":
      return hour >= 6 && hour < 21 ? 0.5 : 0.05;
    case "food":
      if (hour >= 9 && hour < 22) return 0.75;
      if (hour >= 22 && hour < 24) return 0.35;
      // Tea stalls and breakfast places open early.
      if (hour >= 6 && hour < 9) return 0.4;
      return 0.05;
    default:
      if (hour >= 9 && hour < 20) return 0.75;
      if (hour >= 20 && hour < 22) return 0.45;
      if (hour >= 22 && hour < 23) return 0.15;
      // Dairies, newspaper stands and general stores open from about 7.
      if (hour >= 7 && hour < 9) return 0.25;
      return 0.03;
  }
}

export function openProbability(index: FeatureIndex, poi: Poi, at: Date, tz: string): { p: number; known: boolean } {
  if (poi.openingHours) {
    const oh = index.openingHours(poi.openingHours);
    if (oh) {
      try {
        const local = wallClockDate(at, tz);
        if (oh.getUnknown(local)) return { p: 0.5, known: false };
        return { p: oh.getState(local) ? 1 : 0, known: true };
      } catch {
        // fall through to the default
      }
    }
  }
  return { p: defaultOpenProbability(poi.kind, wallParts(at, tz).hour), known: false };
}

export function activityScore(weightedOpenPerHundredM: number): number {
  return Math.round(100 * (1 - Math.exp(-weightedOpenPerHundredM / 2)));
}

export function helpScore(policeM: number | null, havenM: number | null, cctv: number): number {
  const police = policeM == null ? 20 : policeM <= 300 ? 100 : policeM >= 2000 ? 20 : 100 - ((policeM - 300) / 1700) * 80;
  const haven = havenM == null ? 30 : havenM <= 200 ? 100 : havenM >= 1000 ? 30 : 100 - ((havenM - 200) / 800) * 70;
  return Math.round(Math.min(100, Math.max(police, 0.85 * haven) + (cctv > 0 ? 10 : 0)));
}

/**
 * Natural surveillance from buildings facing the street (CPTED): homes and shops
 * mean windows, doors and people who can see and hear. `share` is the fraction
 * of the street with a building footprint within 25 m.
 */
export function frontageScore(share: number): number {
  return Math.round(15 + 85 * Math.min(1, Math.max(0, share)));
}

export const FRONTAGE_M = 25;

/** Below this many mapped buildings per km, building data is treated as missing rather than as empty land. */
export const MIN_BUILDINGS_PER_KM = 3;

export function transitScore(distanceM: number | null): number {
  if (distanceM == null) return 40;
  if (distanceM <= 100) return 100;
  if (distanceM <= 250) return 75;
  if (distanceM <= 500) return 55;
  return 40;
}

/** Weight of one community report at travel time (signed: negative reassures). */
export function reportWeight(report: CommunityReport, at: Date, period: LightPeriod, tz: string): number {
  const cat = reportCategory(report.category);
  if (!cat) return 0;
  const ageDays = (at.getTime() - report.observedAt.getTime()) / 86_400_000;
  if (ageDays > REPORT_MAX_AGE_DAYS || ageDays < -1) return 0;
  if (report.flags >= 3 && report.flags > report.upvotes) return 0;
  const dark = isDark(period) || period === "twilight";
  if (cat.darkOnly && !dark) return 0;
  const decay = Math.pow(0.5, Math.max(0, ageDays) / cat.halfLifeDays);
  // Unconfirmed reports count for less; confirmations raise and flags lower credibility.
  const credibility = Math.max(0.2, Math.min(1.5, 0.6 + 0.2 * report.upvotes - 0.25 * report.flags));
  const reportHour = wallParts(report.observedAt, tz).hour;
  const reportedAtNight = reportHour >= 19 || reportHour < 6;
  const timeMatch = reportedAtNight === dark ? 1 : reportedAtNight ? 0.4 : 0.7;
  return cat.severity * decay * credibility * timeMatch;
}

export function communityScore(totalWeight: number): number {
  if (totalWeight >= 0) return Math.round(80 * Math.exp(-totalWeight / 1.5));
  return Math.round(80 + 20 * (1 - Math.exp(totalWeight)));
}


// ---------------------------------------------------------------------------
// Stretch evaluation: shared by route scoring, safe-path search and area checks
// ---------------------------------------------------------------------------

export const HAVEN_KINDS = new Set<PoiKind>(["hospital", "fuel", "pharmacy"]);

/** How far an unmapped input may plausibly sit from its prior, for the score range. */
const UNKNOWN_LIGHT_SPREAD = 30;
const UNKNOWN_WALK_SPREAD = 20;
const UNKNOWN_FRONTAGE: [number, number] = [20, 85];
/** Missing shops can only mean more people than counted, never fewer. */
const SPARSE_PLACES_UPLIFT = 40;

/**
 * Places counted within 60 m of a stretch of length L cover L·120 + π·60² m².
 * A 100 m stretch is the reference, so counts are scaled to that area.
 */
const PLACES_RADIUS_M = 60;
const REF_AREA = 100 * 2 * PLACES_RADIUS_M + Math.PI * PLACES_RADIUS_M ** 2;
export function placesScale(lengthM: number) {
  return REF_AREA / (Math.max(0, lengthM) * 2 * PLACES_RADIUS_M + Math.PI * PLACES_RADIUS_M ** 2);
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

export interface SampleFacts {
  point: LngLat;
  road: Road | null;
  light: { score: number; known: boolean };
  walk: { score: number; known: boolean; reason?: string };
  isolation: { score: number; worst?: AreaKind };
  major: boolean;
  footpath: boolean;
  tiles: boolean;
}

export interface StretchResult {
  factors: Record<Factor, number>;
  lo: Record<Factor, number>;
  hi: Record<Factor, number>;
  score: number;
  scoreLo: number;
  scoreHi: number;
  reasons: string[];
  openIds: string[];
  cctvIds: string[];
  reportIds: string[];
  policeM: number | null;
  ohKnown: number;
  ohTotal: number;
}

/**
 * Evaluates stretches of street at a given moment. One instance per plan or
 * check: it caches what is shared between nearby stretches (help nearby,
 * opening hours).
 */
export class StretchEvaluator {
  readonly period: LightPeriod;
  readonly dark: boolean;
  readonly weights: Record<Factor, number>;
  private readonly helpMemo = new Map<string, { policeM: number | null; havenM: number | null }>();

  constructor(
    readonly index: FeatureIndex,
    readonly ctx: ScoringContext,
    period: LightPeriod,
    /** Whether buildings are mapped well enough here to judge frontage. */
    readonly buildingsMapped: boolean,
  ) {
    this.period = period;
    this.dark = isDark(period);
    this.weights = WEIGHTS[period];
  }

  /** Facts about one point on a known street (or the nearest mapped one). */
  sample(point: LngLat, road?: Road | null): SampleFacts {
    const matched = road === undefined ? (this.index.nearestRoad(point, 20) ?? this.index.nearestRoad(point, 35))?.road ?? null : road;
    const tags = matched?.tags;
    let lamps = 0;
    for (const n of this.index.pois.near(point, 35)) if (n.item.kind === "lamp") lamps++;
    const walk = walkpathScore(tags, this.dark, { stepFree: this.ctx.stepFree, heavyRain: this.ctx.heavyRain });
    const light = lightingScore(tags, lamps);
    // Fog scatters street light and hides people from view; lighting counts for less.
    if (this.ctx.foggy && this.period !== "day") light.score = Math.round(light.score * 0.8);
    return {
      point,
      road: matched,
      light,
      walk,
      isolation: isolationScore(this.index.areasAt(point), this.period),
      major: !!tags?.highway && MAJOR.has(tags.highway),
      footpath: walk.score >= 80,
      tiles: this.index.fromTiles(point),
    };
  }

  private help(center: LngLat, when: Date) {
    // Help changes slowly with position: share it within ~150 m cells and per hour.
    const key = `${Math.floor(center[0] / 0.0015)}:${Math.floor(center[1] / 0.0015)}:${Math.floor(when.getTime() / 3600_000)}`;
    const hit = this.helpMemo.get(key);
    if (hit) return hit;
    let policeM: number | null = null;
    let havenM: number | null = null;
    for (const { item, distance } of this.index.pois.near(center, 2000)) {
      if (item.kind === "police" && (policeM == null || distance < policeM)) policeM = distance;
      if (HAVEN_KINDS.has(item.kind) && distance <= 1000 && (havenM == null || distance < havenM)) {
        if (openProbability(this.index, item, when, this.ctx.tz).p >= 0.5) havenM = distance;
      }
    }
    const out = { policeM, havenM };
    this.helpMemo.set(key, out);
    return out;
  }

  /** Factor scores, their plausible range and reasons for one stretch of `lengthM` metres. */
  stretch(samples: SampleFacts[], lengthM: number, center: LngLat, when: Date): StretchResult {
    const { index, ctx, period, dark, weights } = this;
    const nearby = new Map<string, Poi>();
    const cctv = new Set<string>();
    const reports = new Map<string, CommunityReport>();
    let frontageSamples = 0;
    let transitM: number | null = null;
    for (const f of samples) {
      for (const { item, distance } of index.pois.near(f.point, 150)) {
        if (item.kind === "transit") transitM = transitM == null ? distance : Math.min(transitM, distance);
        if (distance <= 50 && item.kind === "cctv") cctv.add(item.id);
        if (distance <= PLACES_RADIUS_M && ACTIVITY_WEIGHT[item.kind] != null) nearby.set(item.id, item);
      }
      for (const { item } of index.reports.near(f.point, 60)) reports.set(item.id, item);
      if (this.buildingsMapped && index.buildings.some(f.point, 150, (b) => distanceToBBox(f.point, b) <= FRONTAGE_M)) frontageSamples++;
    }

    let weightedOpen = 0;
    let ohKnown = 0;
    let ohTotal = 0;
    const openIds: string[] = [];
    for (const poi of nearby.values()) {
      const { p, known } = openProbability(index, poi, when, ctx.tz);
      if (poi.kind !== "transit" && poi.kind !== "atm") {
        ohTotal++;
        if (known) ohKnown++;
        if (p >= 0.5) openIds.push(poi.id);
      }
      weightedOpen += p * (ACTIVITY_WEIGHT[poi.kind] ?? 0);
    }
    if (ctx.raining && period !== "day") weightedOpen *= 0.7;
    let activity = activityScore(weightedOpen * placesScale(lengthM));
    const majorShare = samples.filter((f) => f.major).length / Math.max(1, samples.length);
    if (dark && majorShare > 0.5) activity = Math.min(100, activity + 8); // passing traffic adds some visibility

    const { policeM, havenM } = this.help(center, when);

    let reportTotal = 0;
    const reportIds: string[] = [];
    const reportCats = new Map<string, number>();
    for (const r of reports.values()) {
      const w = reportWeight(r, when, period, ctx.tz);
      if (w !== 0) {
        reportIds.push(r.id);
        reportTotal += w;
        if (w > 0) reportCats.set(r.category, (reportCats.get(r.category) ?? 0) + 1);
      }
    }

    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const factors: Record<Factor, number> = {
      lighting: Math.round(mean(samples.map((f) => f.light.score))),
      activity,
      frontage: this.buildingsMapped ? frontageScore(frontageSamples / Math.max(1, samples.length)) : 50,
      walkpath: Math.round(mean(samples.map((f) => f.walk.score))),
      isolation: Math.round(mean(samples.map((f) => f.isolation.score))),
      help: helpScore(policeM, havenM, cctv.size),
      transit: transitScore(transitM),
      community: communityScore(reportTotal),
    };

    // Plausible range: unmapped inputs at their worst and best.
    const lo = { ...factors };
    const hi = { ...factors };
    lo.lighting = Math.round(mean(samples.map((f) => (f.light.known ? f.light.score : clamp(f.light.score - UNKNOWN_LIGHT_SPREAD, 5)))));
    hi.lighting = Math.round(mean(samples.map((f) => (f.light.known ? f.light.score : clamp(f.light.score + UNKNOWN_LIGHT_SPREAD)))));
    lo.walkpath = Math.round(mean(samples.map((f) => (f.walk.known ? f.walk.score : clamp(f.walk.score - UNKNOWN_WALK_SPREAD, 5)))));
    hi.walkpath = Math.round(mean(samples.map((f) => (f.walk.known ? f.walk.score : clamp(f.walk.score + UNKNOWN_WALK_SPREAD)))));
    if (!this.buildingsMapped) [lo.frontage, hi.frontage] = UNKNOWN_FRONTAGE;
    if (index.placesSparse || samples.some((f) => f.tiles)) hi.activity = clamp(activity + SPARSE_PLACES_UPLIFT);
    else if (ohTotal >= 3 && ohKnown / ohTotal < 0.3) [lo.activity, hi.activity] = [clamp(activity - 10), clamp(activity + 10)];

    let score = 0;
    let scoreLo = 0;
    let scoreHi = 0;
    for (const f of FACTORS) {
      score += factors[f] * weights[f];
      scoreLo += lo[f] * weights[f];
      scoreHi += hi[f] * weights[f];
    }

    const reasons: string[] = [];
    if (weights.lighting > 0 && factors.lighting < 45) {
      const known = samples.some((f) => f.light.known);
      reasons.push(ctx.foggy ? "Dim in fog" : known ? "Poorly lit stretch" : "Street lighting not mapped here");
    }
    if (factors.activity < 35) reasons.push(dark ? "Few open shops or people at this hour" : "Few shops or people around");
    if (this.buildingsMapped && factors.frontage < 35) reasons.push("Few buildings facing the street");
    const walkReason = samples.find((f) => f.walk.reason)?.walk.reason;
    if ((factors.walkpath < 50 || (ctx.stepFree && walkReason)) && walkReason) reasons.push(walkReason);
    const worstArea = samples.find((f) => f.isolation.worst)?.isolation.worst;
    if (factors.isolation < 60 && worstArea) reasons.push(`Passes ${AREA_PENALTY[worstArea].label}`);
    if (factors.help < 40) reasons.push(policeM == null ? "No police station within 2 km" : `Police station ${(policeM / 1000).toFixed(1)} km away`);
    if (factors.community < 50 && reportCats.size) {
      const list = [...reportCats.entries()].map(([c, n]) => `${reportCategory(c)?.label.toLowerCase() ?? c}${n > 1 ? ` ×${n}` : ""}`);
      reasons.push(`Community reports: ${list.join(", ")}`);
    }

    return {
      factors,
      lo,
      hi,
      score: Math.round(score),
      scoreLo: Math.round(scoreLo),
      scoreHi: Math.round(scoreHi),
      reasons,
      openIds,
      cctvIds: [...cctv],
      reportIds,
      policeM,
      ohKnown,
      ohTotal,
    };
  }
}

/** Whether buildings are mapped densely enough along these points to judge frontage. */
export function buildingsMappedAlong(index: FeatureIndex, points: LngLat[], lengthM: number): boolean {
  const near = new Set<BBox>();
  let checked = 0;
  let alongside = 0;
  for (let i = 0; i < points.length; i += 3) {
    const p = points[i];
    for (const { item } of index.buildings.near(p, 150)) near.add(item);
    checked++;
    if (index.buildings.some(p, 150, (b) => distanceToBBox(p, b) <= FRONTAGE_M)) alongside++;
  }
  // Mapped if buildings are reasonably dense, or a few large ones (a mall, a colonnade) line much of the way.
  return lengthM > 0 && (near.size / Math.max(0.2, lengthM / 1000) >= MIN_BUILDINGS_PER_KM || (checked > 0 && alongside / checked >= 0.2));
}

/** Light period for a trip: taken at the midpoint time and place, so explanations stay coherent. */
export function tripPeriod(coordinates: LngLat[], durationS: number, ctx: ScoringContext): LightPeriod {
  const mid = coordinates[Math.floor(coordinates.length / 2)] ?? coordinates[0];
  const midTime = new Date(ctx.departAt.getTime() + (durationS * 1000) / 2);
  return lightPeriod(midTime, mid[1], mid[0], ctx.tz);
}

/** Route score from segments: a length-weighted mean, pulled down by the weakest 10%. */
export function aggregate(segments: { from: number; to: number; value: number }[]): number {
  if (!segments.length) return 0;
  const segLen = (s: { from: number; to: number }) => Math.max(1, s.to - s.from);
  const totalLen = segments.reduce((a, s) => a + segLen(s), 0) || 1;
  const mean = segments.reduce((a, s) => a + s.value * segLen(s), 0) / totalLen;
  const sorted = [...segments].sort((a, b) => a.value - b.value);
  let acc = 0;
  let p10 = sorted[0].value;
  for (const s of sorted) {
    acc += segLen(s);
    p10 = s.value;
    if (acc >= totalLen * 0.1) break;
  }
  return Math.round(0.65 * mean + 0.35 * p10);
}

/** Confidence from the score's range and how much of the way is on mapped streets. */
export function confidenceOf(width: number, matchedShare: number): ConfidenceLevel {
  if (matchedShare < 0.6 || width >= 30) return "insufficient";
  if (width >= 18 || matchedShare < 0.8) return "low";
  if (width >= 9) return "medium";
  return "high";
}

export function scoreRoute(coordinates: LngLat[], durationS: number, index: FeatureIndex, ctx: ScoringContext): RouteSafety {
  const samples = resample(coordinates, SAMPLE_STEP_M);
  const total = samples.at(-1)?.at ?? 0;
  const period = tripPeriod(coordinates, durationS, ctx);
  const buildingsMapped = buildingsMappedAlong(
    index,
    samples.map((s) => s.point),
    total,
  );
  const ev = new StretchEvaluator(index, ctx, period, buildingsMapped);
  const weights = ev.weights;
  const etaAt = (at: number) => new Date(ctx.departAt.getTime() + (total > 0 ? (at / total) * durationS * 1000 : 0));

  const stepWays = new Set<string>();
  const facts = samples.map((s) => {
    const f = ev.sample(s.point);
    if (f.road?.tags.highway === "steps") stepWays.add(f.road.id);
    return { at: s.at, f };
  });

  // Group samples into ~100 m segments.
  const groups: (typeof facts)[] = [];
  for (const x of facts) {
    const g = Math.min(Math.floor(x.at / SEGMENT_M), Math.max(0, Math.ceil(total / SEGMENT_M) - 1));
    (groups[g] ??= []).push(x);
  }

  let ohKnown = 0;
  let ohTotal = 0;
  let nearestPolice: number | null = null;
  const cctvSeen = new Set<string>();
  const reportsSeen = new Set<string>();
  const openSeen = new Set<string>();
  const segments: ScoredSegment[] = [];
  for (const group of groups) {
    if (!group?.length) continue;
    const from = group[0].at;
    const to = group.at(-1)!.at;
    const len = Math.max(SAMPLE_STEP_M, to - from + SAMPLE_STEP_M);
    const center = group[Math.floor(group.length / 2)].f.point;
    const r = ev.stretch(
      group.map((x) => x.f),
      len,
      center,
      etaAt((from + to) / 2),
    );
    ohKnown += r.ohKnown;
    ohTotal += r.ohTotal;
    r.openIds.forEach((id) => openSeen.add(id));
    r.cctvIds.forEach((id) => cctvSeen.add(id));
    r.reportIds.forEach((id) => reportsSeen.add(id));
    if (r.policeM != null) nearestPolice = nearestPolice == null ? r.policeM : Math.min(nearestPolice, r.policeM);
    segments.push({
      from,
      to: Math.min(total, to + SAMPLE_STEP_M),
      coordinates: coordinatesBetween(coordinates, from, to + SAMPLE_STEP_M),
      score: r.score,
      lo: r.scoreLo,
      hi: r.scoreHi,
      factors: r.factors,
      reasons: r.reasons,
    });
  }

  const score = aggregate(segments.map((s) => ({ from: s.from, to: s.to, value: s.score })));
  const lo = Math.min(score, aggregate(segments.map((s) => ({ from: s.from, to: s.to, value: s.lo ?? s.score }))));
  const hi = Math.max(score, aggregate(segments.map((s) => ({ from: s.from, to: s.to, value: s.hi ?? s.score }))));

  const segLen = (s: ScoredSegment) => Math.max(1, s.to - s.from);
  const totalLen = segments.reduce((a, s) => a + segLen(s), 0) || 1;
  const factorAvg = {} as Record<Factor, number>;
  for (const f of FACTORS) factorAvg[f] = Math.round(segments.reduce((a, s) => a + s.factors[f] * segLen(s), 0) / totalLen);

  const all = facts.map((x) => x.f);
  const litKnown = all.filter((f) => f.light.known);
  const litShare = litKnown.length ? litKnown.filter((f) => f.light.score >= 75).length / litKnown.length : null;
  const footpathShare = all.length ? all.filter((f) => f.footpath).length / all.length : 0;
  const matchedShare = all.length ? all.filter((f) => f.road).length / all.length : 0;
  const tilesShare = all.length ? all.filter((f) => f.tiles).length / all.length : 0;

  const notes: string[] = [];
  if (matchedShare < 0.8) notes.push(`Only ${Math.round(matchedShare * 100)}% of this route follows mapped streets or paths.`);
  if (weights.lighting > 0) {
    const share = all.length ? litKnown.length / all.length : 0;
    if (share < 0.3) notes.push(`Street lighting is mapped for ${share < 0.05 ? "almost none" : `only ${Math.round(share * 100)}%`} of this route, so lighting is estimated from road type.`);
  }
  const majorFacts = all.filter((f) => f.major);
  if (majorFacts.length && majorFacts.filter((f) => f.walk.known).length / majorFacts.length < 0.3) notes.push("Footpaths along main roads are mostly unmapped here.");
  if (ohTotal && ohKnown / ohTotal < 0.3) notes.push("Few places list opening hours; open/closed is estimated from typical hours.");
  if (index.placesSparse) notes.push("Shops and eateries look under-mapped in this area, so there may be more people around than counted.");
  if (!buildingsMapped) notes.push("Buildings are barely mapped along this route, so frontage is not judged.");
  if (tilesShare > 0.2) {
    notes.push(
      tilesShare > 0.95
        ? "Detailed street data (street lamps, footpaths, opening hours) was unavailable, so this uses the map's base data and typical opening hours."
        : `Detailed street data was unavailable for ${Math.round(tilesShare * 100)}% of this route; that part uses the map's base data.`,
    );
  }

  const width = hi - lo;
  const level = confidenceOf(width, matchedShare);
  if (level === "insufficient") {
    notes.unshift(
      matchedShare < 0.6
        ? "Too little of this route is on mapped streets to score it reliably."
        : `Too much of this route is unmapped to give a reliable score: it could be anywhere from ${lo} to ${hi}.`,
    );
  }

  const highlights: string[] = [];
  if (weights.lighting > 0 && litShare != null && litShare >= 0.6 && litKnown.length / Math.max(1, all.length) >= 0.3) {
    highlights.push(`${Math.round(litShare * 100)}% of mapped stretches are lit`);
  }
  if (footpathShare >= 0.5) highlights.push(`Footpath or pedestrian way for ${Math.round(footpathShare * 100)}% of the walk`);
  if (openSeen.size >= 5) highlights.push(`${openSeen.size} shops and places likely open along the way`);
  if (nearestPolice != null && nearestPolice <= 500) highlights.push(`Police station ${Math.round(nearestPolice)} m from the route`);
  if (buildingsMapped && factorAvg.frontage >= 75) highlights.push("Homes and shops line most of the way");
  if (cctvSeen.size) highlights.push(`${cctvSeen.size} mapped CCTV camera${cctvSeen.size > 1 ? "s" : ""}`);

  return {
    score,
    band: score >= 70 ? "good" : score >= 50 ? "caution" : "avoid",
    period,
    factors: factorAvg,
    weights,
    segments,
    weakStretches: findWeakStretches(segments),
    highlights,
    confidence: { level, coverage: Math.round(clamp(1 - width / 40, 0, 1) * matchedShare * 100) / 100, notes },
    range: { lo, hi },
    conservative: Math.round((score + lo) / 2),
    stats: {
      litShare: litShare == null ? null : Math.round(litShare * 100) / 100,
      footpathShare: Math.round(footpathShare * 100) / 100,
      openPlaces: openSeen.size,
      nearestPoliceM: nearestPolice == null ? null : Math.round(nearestPolice),
      cctv: cctvSeen.size,
      reportsNearby: reportsSeen.size,
      steps: stepWays.size,
      matchedShare: Math.round(matchedShare * 100) / 100,
      tilesShare: Math.round(tilesShare * 100) / 100,
    },
  };
}

export const WEAK_THRESHOLD = 50;

export function findWeakStretches(segments: ScoredSegment[], threshold = WEAK_THRESHOLD, minLengthM = 80): WeakStretch[] {
  const out: WeakStretch[] = [];
  let run: ScoredSegment[] = [];
  const flush = () => {
    if (!run.length) return;
    const from = run[0].from;
    const to = run.at(-1)!.to;
    if (to - from >= minLengthM) {
      const counts = new Map<string, number>();
      for (const s of run) for (const r of s.reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
      const reasons = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r).slice(0, 3);
      const middle = run[Math.floor(run.length / 2)];
      out.push({
        from,
        to,
        length: Math.round(to - from),
        score: Math.round(run.reduce((a, s) => a + s.score, 0) / run.length),
        center: middle.coordinates[Math.floor(middle.coordinates.length / 2)] ?? middle.coordinates[0],
        reasons,
      });
    }
    run = [];
  };
  for (const s of segments) {
    if (s.score < threshold) run.push(s);
    else flush();
  }
  flush();
  return out;
}

/** Sub-line between two distances along `line`. */
export function coordinatesBetween(line: LngLat[], fromM: number, toM: number): LngLat[] {
  const out: LngLat[] = [];
  let cumulative = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const len = haversine(a, b);
    const segStart = cumulative;
    const segEnd = cumulative + len;
    if (segEnd >= fromM && segStart <= toM && len > 0) {
      const t0 = Math.max(0, (fromM - segStart) / len);
      const t1 = Math.min(1, (toM - segStart) / len);
      const p0: LngLat = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
      const p1: LngLat = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      if (!out.length) out.push(p0);
      out.push(p1);
    }
    cumulative = segEnd;
    if (cumulative > toM) break;
  }
  if (out.length === 1) out.push(out[0]);
  return out.length ? out : line.slice(0, 2);
}
