// Geometry helpers. Coordinates follow GeoJSON order: [lng, lat].

export type LngLat = [number, number];

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLength(coords: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
  return total;
}

export function bearing(a: LngLat, b: LngLat): number {
  const dLng = toRad(b[0] - a[0]);
  const y = Math.sin(dLng) * Math.cos(toRad(b[1]));
  const x =
    Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) -
    Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached by travelling `distanceM` from `origin` on `bearingDeg`. */
export function destinationPoint(origin: LngLat, bearingDeg: number, distanceM: number): LngLat {
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(origin[1]);
  const λ1 = toRad(origin[0]);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [((toDeg(λ2) + 540) % 360) - 180, toDeg(φ2)];
}

/**
 * Local equirectangular projection around `ref`, in metres. Accurate to well under
 * a metre over the few-hundred-metre distances used for matching.
 */
function project(p: LngLat, ref: LngLat): [number, number] {
  const x = toRad(p[0] - ref[0]) * Math.cos(toRad(ref[1])) * EARTH_RADIUS_M;
  const y = toRad(p[1] - ref[1]) * EARTH_RADIUS_M;
  return [x, y];
}

/** Distance in metres from `p` to segment a–b, plus the fraction t along the segment. */
export function pointToSegment(p: LngLat, a: LngLat, b: LngLat): { distance: number; t: number } {
  const [px, py] = project(p, a);
  const [bx, by] = project(b, a);
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  const dx = px - t * bx;
  const dy = py - t * by;
  return { distance: Math.sqrt(dx * dx + dy * dy), t };
}

export interface PolylineMatch {
  distance: number;
  /** Index of the segment start vertex. */
  index: number;
  /** Metres from the start of the line to the closest point. */
  along: number;
}

export function distanceToPolyline(p: LngLat, line: LngLat[]): PolylineMatch {
  if (line.length === 0) return { distance: Infinity, index: 0, along: 0 };
  if (line.length === 1) return { distance: haversine(p, line[0]), index: 0, along: 0 };
  let best: PolylineMatch = { distance: Infinity, index: 0, along: 0 };
  let cumulative = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const segLen = haversine(line[i], line[i + 1]);
    const { distance, t } = pointToSegment(p, line[i], line[i + 1]);
    if (distance < best.distance) best = { distance, index: i, along: cumulative + t * segLen };
    cumulative += segLen;
  }
  return best;
}

export interface Sample {
  point: LngLat;
  /** Metres from route start. */
  at: number;
}

/** Points every `stepM` metres along the line, always including both ends. */
export function resample(line: LngLat[], stepM: number): Sample[] {
  if (line.length === 0) return [];
  const out: Sample[] = [{ point: line[0], at: 0 }];
  let cumulative = 0;
  let nextAt = stepM;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const segLen = haversine(a, b);
    while (segLen > 0 && nextAt <= cumulative + segLen) {
      const t = (nextAt - cumulative) / segLen;
      out.push({ point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], at: nextAt });
      nextAt += stepM;
    }
    cumulative += segLen;
  }
  const last = line[line.length - 1];
  if (cumulative - out[out.length - 1].at > 1) out.push({ point: last, at: cumulative });
  return out;
}

/** Douglas–Peucker simplification with a tolerance in metres. */
export function simplify(line: LngLat[], toleranceM: number): LngLat[] {
  if (line.length <= 2) return line.slice();
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = pointToSegment(line[i], line[start], line[end]).distance;
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > toleranceM) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export function bboxOf(points: LngLat[], padM = 0): BBox {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  const padLat = padM / 111_320;
  const padLng = padM / (111_320 * Math.max(0.1, Math.cos(toRad((minLat + maxLat) / 2))));
  return { minLng: minLng - padLng, minLat: minLat - padLat, maxLng: maxLng + padLng, maxLat: maxLat + padLat };
}

export function inBBox(p: LngLat, b: BBox): boolean {
  return p[0] >= b.minLng && p[0] <= b.maxLng && p[1] >= b.minLat && p[1] <= b.maxLat;
}

/** Ray-casting point-in-polygon test for a single closed ring. */
export function pointInPolygon(p: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Share of `a` (by sampled length) lying within `toleranceM` of `b`. Used to drop near-duplicate routes. */
export function overlapRatio(a: LngLat[], b: LngLat[], toleranceM = 25): number {
  const samples = resample(a, 30);
  if (!samples.length) return 0;
  let near = 0;
  for (const s of samples) if (distanceToPolyline(s.point, b).distance <= toleranceM) near++;
  return near / samples.length;
}

/**
 * Coarse spatial grid for fast "what is within X metres of this point" lookups
 * over thousands of map features.
 */
export class GridIndex<T> {
  private cells = new Map<string, { p: LngLat; item: T }[]>();
  private readonly cellDeg: number;

  constructor(cellSizeM = 100) {
    this.cellDeg = cellSizeM / 111_320;
  }

  private key(lng: number, lat: number) {
    return `${Math.floor(lng / this.cellDeg)}:${Math.floor(lat / this.cellDeg)}`;
  }

  insert(p: LngLat, item: T) {
    const k = this.key(p[0], p[1]);
    const list = this.cells.get(k);
    if (list) list.push({ p, item });
    else this.cells.set(k, [{ p, item }]);
  }

  /** Items within `radiusM` of `p`, with their distances. */
  near(p: LngLat, radiusM: number): { item: T; distance: number }[] {
    const latSpan = Math.ceil(radiusM / 111_320 / this.cellDeg);
    const lngSpan = Math.ceil(radiusM / (111_320 * Math.max(0.1, Math.cos(toRad(p[1])))) / this.cellDeg);
    const cx = Math.floor(p[0] / this.cellDeg);
    const cy = Math.floor(p[1] / this.cellDeg);
    const out: { item: T; distance: number }[] = [];
    for (let x = cx - lngSpan; x <= cx + lngSpan; x++) {
      for (let y = cy - latSpan; y <= cy + latSpan; y++) {
        const list = this.cells.get(`${x}:${y}`);
        if (!list) continue;
        for (const e of list) {
          const d = haversine(p, e.p);
          if (d <= radiusM) out.push({ item: e.item, distance: d });
        }
      }
    }
    return out;
  }
}
