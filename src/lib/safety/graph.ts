/**
 * The walkable street network, for searching the safest path rather than
 * only checking the few fastest ones a routing server suggests.
 *
 * Built from the same OpenStreetMap ways used for scoring. Each edge runs
 * between two junctions and carries a "risk length": metres weighted by how
 * unsafe its stretches score (safety.ts). A path's cost is its length plus
 * α × its risk length, so α = 0 finds the shortest path and larger α trade
 * distance for safety. Several α give a spread of candidates, which are then
 * scored in full alongside the router's own routes.
 */
import { bearing, GridIndex, haversine, pointToSegment, type LngLat } from "@/lib/geo";
import type { Road } from "@/lib/providers/overpass";
import type { RawRoute, RouteStep } from "@/lib/providers/osrm";

/** Ways a person can walk along. Motorways, construction and private ways are left out. */
const WALKABLE = new Set([
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "road",
  "pedestrian",
  "footway",
  "path",
  "steps",
  "track",
  "cycleway",
  "bridleway",
]);

export function walkable(tags: Record<string, string>): boolean {
  if (!WALKABLE.has(tags.highway)) return false;
  const foot = tags.foot;
  if (foot === "no" || foot === "private") return false;
  if ((tags.access === "no" || tags.access === "private") && !["yes", "designated", "permissive"].includes(foot ?? "")) return false;
  if (tags.indoor === "yes" || tags.indoor === "corridor") return false;
  return true;
}

export interface Edge {
  id: number;
  a: number;
  b: number;
  geom: LngLat[];
  len: number;
  road: Road;
  /** Metres weighted by how unsafe the edge's stretches are; set by the caller. */
  risk: number;
}

export interface Located {
  edge: Edge;
  /** Metres from the edge's start to the nearest point. */
  along: number;
  point: LngLat;
  distance: number;
}

export interface PathPiece {
  road: Road;
  geom: LngLat[];
}

export interface GraphPath {
  coordinates: LngLat[];
  pieces: PathPiece[];
  distance: number;
  cost: number;
}

const keyOf = (p: LngLat) => `${Math.round(p[0] * 1e7)}:${Math.round(p[1] * 1e7)}`;

function lineLength(g: LngLat[]) {
  let d = 0;
  for (let i = 1; i < g.length; i++) d += haversine(g[i - 1], g[i]);
  return d;
}

/** Part of a line between two distances along it; reversed when `fromM > toM`. */
export function subLine(g: LngLat[], fromM: number, toM: number): LngLat[] {
  const reverse = fromM > toM;
  const lo = Math.min(fromM, toM);
  const hi = Math.max(fromM, toM);
  const out: LngLat[] = [];
  let acc = 0;
  for (let i = 0; i < g.length - 1; i++) {
    const len = haversine(g[i], g[i + 1]);
    const s = acc;
    const e = acc + len;
    if (e >= lo && s <= hi && len > 0) {
      const t0 = Math.max(0, (lo - s) / len);
      const t1 = Math.min(1, (hi - s) / len);
      const at = (t: number): LngLat => [g[i][0] + (g[i + 1][0] - g[i][0]) * t, g[i][1] + (g[i + 1][1] - g[i][1]) * t];
      if (!out.length) out.push(at(t0));
      out.push(at(t1));
    }
    acc = e;
    if (acc > hi) break;
  }
  if (!out.length) out.push(g[0]);
  if (out.length === 1) out.push(out[0]);
  return reverse ? out.reverse() : out;
}

/** Local planar coordinates in metres, accurate enough for intersection tests within a city. */
function planar(origin: LngLat) {
  const kx = 111_320 * Math.cos((origin[1] * Math.PI) / 180);
  return (p: LngLat): [number, number] => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * 111_320];
}

/** Where segments ab and cd cross: their parameters t (on ab) and u (on cd), or null. */
function crossing(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): [number, number] | null {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const qp = [c[0] - a[0], c[1] - a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999 ? [t, u] : null;
}

const levelOf = (t: Record<string, string>) => (t.bridge && t.bridge !== "no" ? "b" : t.tunnel && t.tunnel !== "no" ? "t" : "") + (t.layer ?? "0");

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const ids = this.ids;
    const keys = this.keys;
    ids.push(id);
    keys.push(key);
    let i = ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= keys[i]) break;
      [ids[p], ids[i]] = [ids[i], ids[p]];
      [keys[p], keys[i]] = [keys[i], keys[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const ids = this.ids;
    const keys = this.keys;
    const top: [number, number] = [ids[0], keys[0]];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    if (ids.length) {
      ids[0] = lastId;
      keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < ids.length && keys[l] < keys[m]) m = l;
        if (r < ids.length && keys[r] < keys[m]) m = r;
        if (m === i) break;
        [ids[m], ids[i]] = [ids[i], ids[m]];
        [keys[m], keys[i]] = [keys[i], keys[m]];
        i = m;
      }
    }
    return top;
  }
}

export class StreetGraph {
  readonly nodes: LngLat[] = [];
  readonly edges: Edge[] = [];
  readonly adj: number[][] = [];
  private readonly edgeIndex = new GridIndex<{ e: number; i: number }>(50);

  /**
   * @param noding  Also join ways where they cross without a shared node.
   *   Needed for vector-tile roads, whose junction points can be simplified
   *   away; OSM data from Overpass shares real nodes, which are authoritative
   *   (a footway crossing under a flyover must not join it).
   */
  static build(roads: Road[], opts: { snapM?: number; noding?: (r: Road) => boolean } = {}): StreetGraph {
    const g = new StreetGraph();
    const ways = roads.filter((r) => r.geometry.length >= 2 && walkable(r.tags)).map((r) => ({ road: r, geom: r.geometry.slice() }));
    if (!ways.length) return g;
    const toXY = planar(ways[0].geom[0]);
    const snapM = opts.snapM ?? 3;

    // 1. Collect the points to insert into ways: crossings (tiles) and dangling ends close to another way.
    const inserts = new Map<string, { t: number; p: LngLat }[]>();
    const addInsert = (w: number, i: number, t: number, p: LngLat) => {
      const k = `${w}:${i}`;
      (inserts.get(k) ?? inserts.set(k, []).get(k)!).push({ t, p });
    };
    const segGrid = new Map<string, number[]>();
    const segs: { w: number; i: number; a: [number, number]; b: [number, number] }[] = [];
    const CELL = 40;
    ways.forEach((wy, w) => {
      for (let i = 0; i < wy.geom.length - 1; i++) {
        const a = toXY(wy.geom[i]);
        const b = toXY(wy.geom[i + 1]);
        const id = segs.length;
        segs.push({ w, i, a, b });
        const x0 = Math.floor((Math.min(a[0], b[0]) - snapM) / CELL);
        const x1 = Math.floor((Math.max(a[0], b[0]) + snapM) / CELL);
        const y0 = Math.floor((Math.min(a[1], b[1]) - snapM) / CELL);
        const y1 = Math.floor((Math.max(a[1], b[1]) + snapM) / CELL);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) continue; // absurdly long segment; skip noding for it
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) (segGrid.get(`${x}:${y}`) ?? segGrid.set(`${x}:${y}`, []).get(`${x}:${y}`)!).push(id);
      }
    });
    const nearSegs = (p: [number, number]) => segGrid.get(`${Math.floor(p[0] / CELL)}:${Math.floor(p[1] / CELL)}`) ?? [];

    const usage = new Map<string, number>();
    for (const wy of ways) for (const p of wy.geom) usage.set(keyOf(p), (usage.get(keyOf(p)) ?? 0) + 1);

    if (opts.noding) {
      const done = new Set<string>();
      for (const cell of segGrid.values()) {
        for (let x = 0; x < cell.length; x++) {
          for (let y = x + 1; y < cell.length; y++) {
            const s1 = segs[cell[x]];
            const s2 = segs[cell[y]];
            if (s1.w === s2.w) continue;
            const pair = cell[x] < cell[y] ? `${cell[x]}:${cell[y]}` : `${cell[y]}:${cell[x]}`;
            if (done.has(pair)) continue;
            done.add(pair);
            const r1 = ways[s1.w].road;
            const r2 = ways[s2.w].road;
            if (!opts.noding(r1) || !opts.noding(r2) || levelOf(r1.tags) !== levelOf(r2.tags)) continue;
            const hit = crossing(s1.a, s1.b, s2.a, s2.b);
            if (!hit) continue;
            const g1 = ways[s1.w].geom;
            const p: LngLat = [g1[s1.i][0] + (g1[s1.i + 1][0] - g1[s1.i][0]) * hit[0], g1[s1.i][1] + (g1[s1.i + 1][1] - g1[s1.i][1]) * hit[0]];
            addInsert(s1.w, s1.i, hit[0], p);
            addInsert(s2.w, s2.i, hit[1], p);
          }
        }
      }
    }

    // Dangling ends within a few metres of another way: join them (T-junctions whose node was lost).
    ways.forEach((wy, w) => {
      for (const end of [wy.geom[0], wy.geom.at(-1)!]) {
        if ((usage.get(keyOf(end)) ?? 0) > 1) continue;
        const xy = toXY(end);
        let best: { s: number; t: number; d: number } | null = null;
        for (const si of nearSegs(xy)) {
          const s = segs[si];
          if (s.w === w) continue;
          if (levelOf(ways[s.w].road.tags) !== levelOf(wy.road.tags)) continue;
          const { distance, t } = pointToSegment(end, ways[s.w].geom[s.i], ways[s.w].geom[s.i + 1]);
          if (distance <= snapM && (!best || distance < best.d)) best = { s: si, t, d: distance };
        }
        if (!best) continue;
        const s = segs[best.s];
        if (best.t > 0.001 && best.t < 0.999) {
          addInsert(s.w, s.i, best.t, end);
          continue;
        }
        // Right next to the other way's vertex: end on that vertex instead.
        const target = ways[s.w].geom[best.t <= 0.001 ? s.i : s.i + 1];
        wy.geom[end === wy.geom[0] ? 0 : wy.geom.length - 1] = target;
        usage.set(keyOf(target), (usage.get(keyOf(target)) ?? 0) + 1);
      }
    });

    // 2. Apply insertions.
    const byWay = new Map<number, Map<number, LngLat[]>>();
    for (const [k, list] of inserts) {
      const [w, i] = k.split(":").map(Number);
      list.sort((x, y) => x.t - y.t);
      (byWay.get(w) ?? byWay.set(w, new Map()).get(w)!).set(
        i,
        list.map((x) => x.p),
      );
    }
    for (const [w, extra] of byWay) {
      const out: LngLat[] = [];
      ways[w].geom.forEach((p, i) => {
        out.push(p);
        for (const q of extra.get(i) ?? []) out.push(q);
      });
      ways[w].geom = out;
    }

    // 3. Junctions: points used by more than one way (or twice by one), and way ends.
    const count = new Map<string, number>();
    for (const wy of ways) {
      const seen = new Set<string>();
      wy.geom.forEach((p, i) => {
        const k = keyOf(p);
        const extra = i === 0 || i === wy.geom.length - 1 ? 2 : seen.has(k) ? 2 : 1;
        count.set(k, (count.get(k) ?? 0) + extra);
        seen.add(k);
      });
    }
    const nodeId = new Map<string, number>();
    const node = (p: LngLat) => {
      const k = keyOf(p);
      let id = nodeId.get(k);
      if (id == null) {
        id = g.nodes.length;
        g.nodes.push(p);
        g.adj.push([]);
        nodeId.set(k, id);
      }
      return id;
    };

    // 4. Edges between consecutive junctions.
    for (const wy of ways) {
      let start = 0;
      for (let i = 1; i < wy.geom.length; i++) {
        if (i < wy.geom.length - 1 && (count.get(keyOf(wy.geom[i])) ?? 0) < 2) continue;
        const geom = wy.geom.slice(start, i + 1);
        const len = lineLength(geom);
        if (len > 0.5) {
          const a = node(geom[0]);
          const b = node(geom.at(-1)!);
          const e: Edge = { id: g.edges.length, a, b, geom, len, road: wy.road, risk: 0 };
          g.edges.push(e);
          g.adj[a].push(e.id);
          if (b !== a) g.adj[b].push(e.id);
          for (let j = 0; j < geom.length - 1; j++) {
            const segLen = haversine(geom[j], geom[j + 1]);
            const n = Math.max(1, Math.ceil(segLen / 25));
            for (let s = 0; s <= n; s++) {
              const t = s / n;
              g.edgeIndex.insert([geom[j][0] + (geom[j + 1][0] - geom[j][0]) * t, geom[j][1] + (geom[j + 1][1] - geom[j][1]) * t], { e: e.id, i: j });
            }
          }
        }
        start = i;
      }
    }
    return g;
  }

  /** Nearest point on any edge within `maxM`, optionally skipping some edges. */
  locate(p: LngLat, maxM = 250, skip?: Set<number>): Located | null {
    let best: Located | null = null;
    const seen = new Set<string>();
    for (const { item } of this.edgeIndex.near(p, maxM + 30)) {
      const k = `${item.e}:${item.i}`;
      if (seen.has(k) || skip?.has(item.e)) continue;
      seen.add(k);
      const e = this.edges[item.e];
      const { distance, t } = pointToSegment(p, e.geom[item.i], e.geom[item.i + 1]);
      if (distance > maxM || (best && distance >= best.distance)) continue;
      let along = 0;
      for (let j = 0; j < item.i; j++) along += haversine(e.geom[j], e.geom[j + 1]);
      along += t * haversine(e.geom[item.i], e.geom[item.i + 1]);
      const point: LngLat = [e.geom[item.i][0] + (e.geom[item.i + 1][0] - e.geom[item.i][0]) * t, e.geom[item.i][1] + (e.geom[item.i + 1][1] - e.geom[item.i][1]) * t];
      best = { edge: e, along, point, distance };
    }
    return best;
  }

  /**
   * Cheapest path from `from` to `to` where an edge costs len + α·risk.
   * Nodes farther than `maxSumM` (distance to `from` plus to `to`) are not
   * expanded: no path through them can be short enough to offer.
   */
  route(from: LngLat, to: LngLat, alpha: number, opts: { maxSumM?: number; snapM?: number } = {}): GraphPath | null {
    const start = this.locate(from, opts.snapM ?? 250);
    const goal = this.locate(to, opts.snapM ?? 250);
    if (!start || !goal) return null;
    const cost = (e: Edge) => e.len + alpha * e.risk;
    const perM = (e: Edge) => cost(e) / e.len;
    const maxSum = opts.maxSumM ?? Infinity;
    const N = this.nodes.length;
    const SRC = N;
    const DST = N + 1;
    const gScore = new Float64Array(N + 2).fill(Infinity);
    const prev = new Int32Array(N + 2).fill(-1); // node we came from
    const prevEdge = new Int32Array(N + 2).fill(-1);
    const closed = new Uint8Array(N + 2);
    const h = (n: number) => (n === DST ? 0 : n === SRC ? haversine(from, to) : haversine(this.nodes[n], to));
    const heap = new MinHeap();
    gScore[SRC] = 0;
    heap.push(SRC, h(SRC));

    const goalCost = (n: number) => {
      const e = goal.edge;
      if (n === e.a) return goal.along * perM(e);
      if (n === e.b) return (e.len - goal.along) * perM(e);
      return Infinity;
    };
    // Both ends on one edge: walking straight along it is a candidate too.
    let best = start.edge.id === goal.edge.id ? Math.abs(start.along - goal.along) * perM(start.edge) : Infinity;
    if (best < Infinity) {
      gScore[DST] = best;
      prev[DST] = SRC;
    }

    while (heap.size) {
      const [n, f] = heap.pop();
      if (closed[n]) continue;
      closed[n] = 1;
      if (n === DST) break;
      if (f - h(n) > gScore[n] + 1e-6) continue;
      const relax = (m: number, c: number, via: number) => {
        const g2 = gScore[n] + c;
        if (g2 < gScore[m]) {
          gScore[m] = g2;
          prev[m] = n;
          prevEdge[m] = via;
          heap.push(m, g2 + h(m));
        }
      };
      if (n === SRC) {
        const e = start.edge;
        relax(e.a, start.along * perM(e), -2);
        relax(e.b, (e.len - start.along) * perM(e), -3);
        continue;
      }
      const gc = goalCost(n);
      if (gc < Infinity && gScore[n] + gc < gScore[DST]) {
        gScore[DST] = gScore[n] + gc;
        prev[DST] = n;
        prevEdge[DST] = -4;
        heap.push(DST, gScore[DST]);
      }
      const p = this.nodes[n];
      if (maxSum < Infinity && haversine(from, p) + haversine(p, to) > maxSum) continue;
      for (const eid of this.adj[n]) {
        const e = this.edges[eid];
        const m = e.a === n ? e.b : e.a;
        if (!closed[m]) relax(m, cost(e), eid);
      }
    }
    if (!Number.isFinite(gScore[DST])) return null;
    best = gScore[DST];

    // Walk back from the destination.
    const chain: number[] = [];
    for (let n = DST; n !== -1; n = prev[n]) chain.push(n);
    chain.reverse(); // SRC … DST
    const pieces: PathPiece[] = [];
    if (chain.length === 2) {
      pieces.push({ road: start.edge.road, geom: subLine(start.edge.geom, start.along, goal.along) });
    } else {
      const first = chain[1];
      pieces.push({ road: start.edge.road, geom: subLine(start.edge.geom, start.along, first === start.edge.a ? 0 : start.edge.len) });
      for (let i = 2; i < chain.length - 1; i++) {
        const e = this.edges[prevEdge[chain[i]]];
        const forward = e.a === chain[i - 1];
        pieces.push({ road: e.road, geom: forward ? e.geom : e.geom.slice().reverse() });
      }
      const last = chain[chain.length - 2];
      pieces.push({ road: goal.edge.road, geom: subLine(goal.edge.geom, last === goal.edge.a ? 0 : goal.edge.len, goal.along) });
    }
    const coordinates: LngLat[] = [];
    if (start.distance > 3) coordinates.push(from);
    for (const piece of pieces) {
      for (const p of piece.geom) {
        const last = coordinates.at(-1);
        if (!last || haversine(last, p) > 0.3) coordinates.push(p);
      }
    }
    if (goal.distance > 3) coordinates.push(to);
    if (coordinates.length < 2) return null;
    return { coordinates, pieces: pieces.filter((p) => lineLength(p.geom) > 0.3), distance: lineLength(coordinates), cost: best };
  }
}

// ---------------------------------------------------------------------------
// Turn-by-turn directions for paths found here
// ---------------------------------------------------------------------------

/** Walking speed matching OSRM's foot profile (5 km/h); steps are slower. */
export const WALK_SPEED_MPS = 5 / 3.6;
const STEPS_SPEED_MPS = 0.6;

const DESCRIPTOR: Record<string, string> = {
  footway: "the footpath",
  pedestrian: "the pedestrian street",
  path: "the path",
  steps: "the steps",
  track: "the track",
  cycleway: "the cycle path",
  bridleway: "the path",
  living_street: "the lane",
  residential: "the street",
  unclassified: "the road",
  service: "the service road",
  road: "the road",
};

export function wayLabel(tags: Record<string, string>): string {
  if (tags.name) return tags.name;
  if (tags.ref) return tags.ref;
  if (tags.highway === "service" && tags.service === "alley") return "the lane";
  if (/^(trunk|primary|secondary|tertiary)/.test(tags.highway ?? "")) return "the main road";
  return DESCRIPTOR[tags.highway] ?? "the road";
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const compass = (b: number) => COMPASS[Math.round((((b % 360) + 360) % 360) / 45) % 8];

function pointAlong(g: LngLat[], m: number): LngLat {
  return subLine(g, m, m)[0];
}

interface Leg {
  key: string;
  tags: Record<string, string>;
  geom: LngLat[];
  len: number;
}

const isCrossing = (t: Record<string, string>) => t.footway === "crossing" || t.highway === "crossing";

/** Instructions for a path: one per change of street, with the turn at each. */
export function buildSteps(pieces: PathPiece[]): RouteStep[] {
  const legs: Leg[] = [];
  const endBearing = (g: LngLat[], len: number) => bearing(pointAlong(g, Math.max(0, len - 15)), g.at(-1)!);
  const startBearing = (g: LngLat[], len: number) => bearing(g[0], pointAlong(g, Math.min(len, 15)));
  for (const p of pieces) {
    const len = lineLength(p.geom);
    const t = p.road.tags;
    const key = isCrossing(t) ? `x:${p.road.id}` : t.name ? `n:${t.name}` : t.ref ? `r:${t.ref}` : `u:${wayLabel(t)}`;
    const last = legs.at(-1);
    if (last && last.key === key) {
      const turn = Math.abs(((startBearing(p.geom, len) - endBearing(last.geom, last.len) + 540) % 360) - 180);
      // Same named street: always one leg. Unnamed ways of one kind: one leg unless there's a real turn.
      if (key.startsWith("n:") || key.startsWith("r:") || turn < 50) {
        last.geom = [...last.geom, ...p.geom.slice(1)];
        last.len += len;
        continue;
      }
    }
    legs.push({ key, tags: t, geom: p.geom, len });
  }
  // A first leg of a few metres (from the doorstep to the street) is folded into the next.
  if (legs.length > 1 && legs[0].len < 12 && !isCrossing(legs[1].tags)) {
    legs[1].geom = [...legs[0].geom, ...legs[1].geom.slice(1)];
    legs[1].len += legs[0].len;
    legs.shift();
  }
  // Fold very short legs (a few metres of a side lane) into the one before.
  for (let i = legs.length - 2; i >= 1; i--) {
    if (legs[i].len < 12 && !isCrossing(legs[i].tags)) {
      legs[i - 1].geom = [...legs[i - 1].geom, ...legs[i].geom.slice(1)];
      legs[i - 1].len += legs[i].len;
      legs.splice(i, 1);
    }
  }
  const steps: RouteStep[] = [];
  legs.forEach((leg, i) => {
    const label = wayLabel(leg.tags);
    let instruction: string;
    if (isCrossing(leg.tags)) {
      instruction = ["zebra", "marked", "traffic_signals", "uncontrolled"].includes(leg.tags.crossing ?? "") ? "Cross the road at the pedestrian crossing" : "Cross the road";
    } else if (i === 0) {
      instruction = `Head ${compass(startBearing(leg.geom, leg.len))} on ${label}`;
    } else {
      const prev = legs[i - 1];
      const turn = ((startBearing(leg.geom, leg.len) - endBearing(prev.geom, prev.len) + 540) % 360) - 180;
      const dir = turn > 0 ? "right" : "left";
      const a = Math.abs(turn);
      if (leg.tags.highway === "steps") instruction = a < 30 ? "Take the steps ahead" : `Turn ${dir} and take the steps`;
      else if (a < 20) instruction = `Continue onto ${label}`;
      else if (a < 55) instruction = `Bear ${dir} onto ${label}`;
      else if (a < 150) instruction = `Turn ${dir} onto ${label}`;
      else instruction = `Make a U-turn onto ${label}`;
    }
    const speed = leg.tags.highway === "steps" ? STEPS_SPEED_MPS : WALK_SPEED_MPS;
    steps.push({ instruction, distance: Math.round(leg.len), duration: Math.round(leg.len / speed), location: leg.geom[0] });
  });
  const end = legs.at(-1)?.geom.at(-1);
  if (end) steps.push({ instruction: "You have arrived at your destination", distance: 0, duration: 0, location: end });
  return steps;
}

/** A found path in the same shape as a routing server's route. */
export function toRawRoute(path: GraphPath): RawRoute {
  const steps = buildSteps(path.pieces);
  const duration = steps.reduce((a, s) => a + s.duration, 0) + Math.max(0, path.distance - steps.reduce((a, s) => a + s.distance, 0)) / WALK_SPEED_MPS;
  return { coordinates: path.coordinates, distance: path.distance, duration, steps };
}
