import { describe, expect, it } from "vitest";
import {
  bboxOf,
  destinationPoint,
  distanceToPolyline,
  GridIndex,
  haversine,
  overlapRatio,
  pathLength,
  pointInPolygon,
  resample,
  simplify,
  type LngLat,
} from "@/lib/geo";

// Rajwada, Indore and a point roughly 1 km north.
const A: LngLat = [75.8553, 22.7186];
const north = destinationPoint(A, 0, 1000);

describe("geo", () => {
  it("measures distances on the sphere", () => {
    expect(haversine(A, north)).toBeCloseTo(1000, 0);
    expect(haversine(A, A)).toBe(0);
  });

  it("resamples a line at fixed steps including both ends", () => {
    const samples = resample([A, north], 100);
    expect(samples).toHaveLength(11);
    expect(samples[0].at).toBe(0);
    expect(samples.at(-1)!.at).toBeCloseTo(1000, 0);
    expect(haversine(samples[5].point, A)).toBeCloseTo(500, 0);
  });

  it("finds the distance from a point to a polyline", () => {
    const east = destinationPoint(destinationPoint(A, 0, 500), 90, 40);
    const m = distanceToPolyline(east, [A, north]);
    expect(m.distance).toBeCloseTo(40, 0);
    expect(m.along).toBeCloseTo(500, -1);
  });

  it("simplifies collinear points away", () => {
    const line = resample([A, north], 50).map((s) => s.point);
    expect(simplify(line, 2)).toHaveLength(2);
    expect(pathLength(simplify(line, 2))).toBeCloseTo(1000, 0);
  });

  it("detects points inside polygons", () => {
    const ring: LngLat[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    expect(pointInPolygon([0.5, 0.5], ring)).toBe(true);
    expect(pointInPolygon([1.5, 0.5], ring)).toBe(false);
  });

  it("measures overlap between routes", () => {
    const line = [A, north];
    const parallel = [destinationPoint(A, 90, 300), destinationPoint(north, 90, 300)];
    expect(overlapRatio(line, line)).toBe(1);
    expect(overlapRatio(line, parallel)).toBe(0);
  });

  it("pads bounding boxes in metres", () => {
    const b = bboxOf([A], 1000);
    expect(haversine([b.minLng, A[1]], [b.maxLng, A[1]])).toBeCloseTo(2000, -1);
  });

  it("grid index returns only items within the radius", () => {
    const grid = new GridIndex<string>(100);
    grid.insert(A, "here");
    grid.insert(destinationPoint(A, 45, 80), "near");
    grid.insert(destinationPoint(A, 45, 400), "far");
    const found = grid.near(A, 100).map((x) => x.item).sort();
    expect(found).toEqual(["here", "near"]);
  });
});
