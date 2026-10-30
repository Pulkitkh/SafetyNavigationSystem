/**
 * "Is it safe here right now?": the same factors and weights as route scoring,
 * applied to the streets within ~150 m of one point at the current moment.
 */
import { haversine, resample, type LngLat } from "@/lib/geo";
import type { Poi, PoiKind } from "@/lib/providers/overpass";
import { isDark, lightPeriod, type LightPeriod } from "@/lib/time";
import { FACTORS, type Factor } from "./factors";
import {
  ACTIVITY_WEIGHT,
  activityScore,
  AREA_PENALTY,
  communityScore,
  confidenceOf,
  FeatureIndex,
  FRONTAGE_M,
  frontageScore,
  HAVEN_KINDS,
  helpScore,
  isolationScore,
  lightingScore,
  openProbability,
  reportWeight,
  transitScore,
  walkpathScore,
  WEIGHTS,
  type ConfidenceLevel,
} from "./score";

const STREET_RADIUS_M = 150;
/**
 * Routes count places within 60 m of each 100 m of walk (a 100 × 120 m strip).
 * The 200 m circle used here holds about 10.5 such strips, so dividing by that
 * puts both on the same scale.
 */
const PLACES_RADIUS_M = 200;
const STRIPS_IN_CIRCLE = (Math.PI * PLACES_RADIUS_M ** 2) / (100 * 120);

export interface NearbyPlace {
  id: string;
  name: string;
  kind: PoiKind;
  point: LngLat;
  distance: number;
  openNow: boolean | null;
}

export interface AreaSafety {
  score: number;
  band: "good" | "caution" | "avoid";
  period: LightPeriod;
  factors: Record<Factor, number>;
  weights: Record<Factor, number>;
  reasons: string[];
  highlights: string[];
  /** Places likely open now within 200 m, nearest first. */
  openNearby: NearbyPlace[];
  nearestPolice: NearbyPlace | null;
  /** Nearest open hospital, fuel station or pharmacy: somewhere to wait for help. */
  nearestHaven: NearbyPlace | null;
  stats: { streetsM: number; litShare: number | null; openPlaces: number; cctv: number; reports: number };
  /** "insufficient": too little is mapped here to give a score; the app says so instead of showing one. */
  confidence: ConfidenceLevel;
  /** The score if every unmapped input were at its worst / best plausible value. */
  range: { lo: number; hi: number };
  /** What the score couldn't see, in plain words. */
  notes: string[];
  /** The neighbourhood or village this spot is in, when mapped nearby. */
  place?: string;
  /** Set when the score had to use the lighter vector-tile data. */
  dataNote?: string;
}

export interface AreaContext {
  at: Date;
  tz: string;
  raining?: boolean;
  foggy?: boolean;
}

const KIND_NAMES: Partial<Record<PoiKind, string>> = {
  police: "Police station",
  hospital: "Hospital",
  clinic: "Clinic",
  pharmacy: "Pharmacy",
  fuel: "Petrol pump",
  bank: "Bank",
  atm: "ATM",
  food: "Eatery",
  venue: "Venue",
  worship: "Place of worship",
  shop: "Shop",
  transit: "Bus stop / station",
};

export function scoreArea(point: LngLat, index: FeatureIndex, ctx: AreaContext): AreaSafety {
  const period = lightPeriod(ctx.at, point[1], point[0], ctx.tz);
  const dark = isDark(period);
  const weights = WEIGHTS[period];

  // Sample the mapped streets around the point every 20 m.
  const samples: { point: LngLat; tags: Record<string, string> }[] = [];
  const seen = new Set<string>();
  for (const { item } of index.roads.near(point, STREET_RADIUS_M + 30)) {
    if (seen.has(item.road.id)) continue;
    seen.add(item.road.id);
    for (const s of resample(item.road.geometry, 20)) {
      if (haversine(point, s.point) <= STREET_RADIUS_M) samples.push({ point: s.point, tags: item.road.tags });
    }
  }
  const onStreets = samples.length > 0;
  if (!samples.length) samples.push({ point, tags: index.nearestRoad(point, 60)?.road.tags ?? {} });
  const streetsM = onStreets ? samples.length * 20 : 0;

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const lights = samples.map((s) => {
    const lamps = index.lamps.near(s.point, 35).length;
    const l = lightingScore(s.tags.highway ? s.tags : undefined, lamps);
    return { ...l, score: ctx.foggy && period !== "day" ? Math.round(l.score * 0.8) : l.score };
  });
  const walks = samples.map((s) => walkpathScore(s.tags.highway ? s.tags : undefined, dark));

  // Places and help.
  const open: NearbyPlace[] = [];
  let weightedOpen = 0;
  let cctv = 0;
  let transitM: number | null = null;
  let police: NearbyPlace | null = null;
  let haven: NearbyPlace | null = null;
  for (const { item, distance } of index.pois.near(point, 2000)) {
    const poi = item as Poi;
    if (poi.kind === "lamp") continue;
    if (poi.kind === "cctv") {
      if (distance <= 200) cctv++;
      continue;
    }
    if (poi.kind === "transit") transitM = transitM == null ? distance : Math.min(transitM, distance);
    const { p, known } = openProbability(index, poi, ctx.at, ctx.tz);
    const place: NearbyPlace = {
      id: poi.id,
      name: poi.name ?? KIND_NAMES[poi.kind] ?? "Place",
      kind: poi.kind,
      point: poi.point,
      distance: Math.round(distance),
      openNow: known ? p >= 0.5 : p >= 0.9 ? true : null,
    };
    if (poi.kind === "police" && (!police || distance < police.distance)) police = place;
    if (HAVEN_KINDS.has(poi.kind) && distance <= 1500 && p >= 0.5 && (!haven || distance < haven.distance)) haven = place;
    if (distance <= PLACES_RADIUS_M && ACTIVITY_WEIGHT[poi.kind] != null) {
      weightedOpen += p * (ACTIVITY_WEIGHT[poi.kind] ?? 0);
      if (p >= 0.5 && poi.kind !== "transit" && poi.kind !== "atm") open.push(place);
    }
  }
  if (ctx.raining && period !== "day") weightedOpen *= 0.7;

  let activity = activityScore(weightedOpen / STRIPS_IN_CIRCLE);
  const majorShare = samples.filter((s) => /^(trunk|primary|secondary)/.test(s.tags.highway ?? "")).length / samples.length;
  if (dark && majorShare > 0.5) activity = Math.min(100, activity + 8);

  // Buildings alongside the streets: judged only where buildings are mapped around this spot.
  const buildingsMapped = index.buildings.near(point, 200).length >= 10;
  const alongside = samples.filter((s) => index.buildingWithin(s.point, FRONTAGE_M)).length;

  let reportTotal = 0;
  let reports = 0;
  for (const { item } of index.reports.near(point, 200)) {
    const w = reportWeight(item, ctx.at, period, ctx.tz);
    if (w !== 0) {
      reports++;
      reportTotal += w;
    }
  }

  const iso = isolationScore(index.areasAt(point), period);
  const factors: Record<Factor, number> = {
    lighting: Math.round(mean(lights.map((l) => l.score))),
    activity,
    frontage: buildingsMapped ? frontageScore(alongside / samples.length) : 50,
    walkpath: Math.round(mean(walks.map((w) => w.score))),
    isolation: iso.score,
    help: helpScore(police?.distance ?? null, haven?.distance ?? null, cctv),
    transit: transitScore(transitM),
    community: communityScore(reportTotal),
  };
  let score = 0;
  for (const f of FACTORS) score += factors[f] * weights[f];
  score = Math.round(score);

  // Plausible range: unmapped inputs at their worst and best.
  const lo = { ...factors };
  const hi = { ...factors };
  lo.lighting = Math.round(mean(lights.map((l) => (l.known ? l.score : Math.max(5, l.score - 30)))));
  hi.lighting = Math.round(mean(lights.map((l) => (l.known ? l.score : Math.min(100, l.score + 30)))));
  lo.walkpath = Math.round(mean(walks.map((w) => (w.known ? w.score : Math.max(5, w.score - 20)))));
  hi.walkpath = Math.round(mean(walks.map((w) => (w.known ? w.score : Math.min(100, w.score + 20)))));
  if (!buildingsMapped) [lo.frontage, hi.frontage] = [20, 85];
  const fromTiles = index.fromTiles(point);
  if (index.placesSparse || fromTiles) hi.activity = Math.min(100, activity + 40);
  let scoreLo = 0;
  let scoreHi = 0;
  for (const f of FACTORS) {
    scoreLo += lo[f] * weights[f];
    scoreHi += hi[f] * weights[f];
  }
  const range = { lo: Math.min(score, Math.round(scoreLo)), hi: Math.max(score, Math.round(scoreHi)) };

  const litKnown = lights.filter((l) => l.known);
  const litShare = litKnown.length ? litKnown.filter((l) => l.score >= 75).length / litKnown.length : null;
  const lightingMapped = litKnown.length / samples.length >= 0.3;

  const reasons: string[] = [];
  if (weights.lighting > 0) {
    if (lightingMapped && litShare != null && litShare < 0.4) reasons.push("Streets around here are poorly lit");
    else if (!lightingMapped && factors.lighting < 45) reasons.push("Street lighting isn't mapped here");
  }
  if (factors.activity < 35) reasons.push(dark ? "Few shops or places open at this hour" : "Few shops or people around");
  if (buildingsMapped && factors.frontage < 35) reasons.push("Few buildings facing the street");
  if (iso.worst && factors.isolation < 60) reasons.push(`You're next to ${AREA_PENALTY[iso.worst].label}`);
  if (factors.help < 40) reasons.push(police ? `Nearest police station is ${(police.distance / 1000).toFixed(1)} km away` : "No police station within 2 km");
  if (factors.community < 50) reasons.push(`${reports} recent community report${reports === 1 ? "" : "s"} of trouble nearby`);

  const highlights: string[] = [];
  if (open.length >= 3) highlights.push(`${open.length} places open within 200 m`);
  if (police && police.distance <= 500) highlights.push(`Police station ${police.distance} m away`);
  if (weights.lighting > 0 && lightingMapped && litShare != null && litShare >= 0.6) highlights.push("Most mapped streets here are lit");
  if (cctv) highlights.push(`${cctv} mapped CCTV camera${cctv > 1 ? "s" : ""}`);

  const notes: string[] = [];
  if (!onStreets) notes.push("No mapped streets within 150 m of this spot, so it can't be scored.");
  if (weights.lighting > 0 && !lightingMapped) notes.push("Street lighting isn't mapped around here, so it's estimated from the type of road.");
  if (index.placesSparse) notes.push("Shops and eateries look under-mapped here, so there may be more people around than counted.");
  if (!buildingsMapped) notes.push("Buildings aren't mapped around here, so homes and shops facing the street aren't judged.");
  const confidence = confidenceOf(range.hi - range.lo, onStreets ? 1 : 0);
  if (confidence === "insufficient" && onStreets) notes.unshift(`Too much is unmapped here to give a reliable score: it could be anywhere from ${range.lo} to ${range.hi}.`);
  open.sort((a, b) => a.distance - b.distance);
  return {
    score,
    band: score >= 70 ? "good" : score >= 50 ? "caution" : "avoid",
    period,
    factors,
    weights,
    reasons,
    highlights,
    openNearby: open.slice(0, 8),
    nearestPolice: police,
    nearestHaven: haven,
    stats: { streetsM, litShare: litShare == null ? null : Math.round(litShare * 100) / 100, openPlaces: open.length, cctv, reports },
    confidence,
    range,
    notes,
    ...(index.placeNear(point, 1200) ? { place: index.placeNear(point, 1200)!.place.name } : {}),
    ...(fromTiles
      ? { dataNote: "Live street details (lamps, opening hours) were unavailable, so this uses the map's base data and typical opening hours." }
      : {}),
  };
}
