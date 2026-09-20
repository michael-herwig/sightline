import { describe, expect, it } from "vitest";
import { PX_PER_M } from "../../src/planer/geo";
import {
  angleAt,
  offsetPath,
  pathMid,
  pointAtLen,
  polyLength,
  SECTION_EDGE,
  SECTION_STEP,
  sectionOffsets,
} from "../../src/planer/geom";

const P = (x: number, y: number, at?: string) => (at ? { x, y, at } : { x, y });

// Distance of a point from the infinite line through a and b.
const distToLine = (p: any, a: any, b: any) =>
  Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) /
  Math.hypot(b.x - a.x, b.y - a.y);

describe("angleAt", () => {
  it("measures clockwise from east, because y runs downwards on the map", () => {
    expect(angleAt(0, 0, 10, 0, 0)).toBe(0);
    expect(angleAt(0, 0, 0, 10, 0)).toBe(90);
    expect(angleAt(0, 0, -10, 0, 0)).toBe(180);
    expect(angleAt(0, 0, 0, -10, 0)).toBe(270);
    // Around a centre other than the origin.
    expect(angleAt(100, 100, 110, 100, 0)).toBe(0);
  });

  it("stays inside 0..359", () => {
    expect(angleAt(0, 0, 1, -0.0001, 0)).toBe(0);
    expect(angleAt(0, 0, -10, -0.01, 0)).toBe(180);
  });

  it("snap rounds to steps — that is Shift while rotating", () => {
    expect(angleAt(0, 0, 10, 1, 45)).toBe(0);
    expect(angleAt(0, 0, 10, 10, 45)).toBe(45);
    expect(angleAt(0, 0, 10, 5, 45)).toBe(45);
    expect(angleAt(0, 0, 10, 5, 15)).toBe(30);
    // Without snap the same point keeps its exact angle.
    expect(angleAt(0, 0, 10, 5, 0)).toBe(27);
  });
});

describe("polyLength", () => {
  it("is the sum of the segments, in metres", () => {
    expect(polyLength([P(0, 0), P(10 * PX_PER_M, 0)])).toBeCloseTo(10, 9);
    expect(polyLength([P(0, 0), P(3 * PX_PER_M, 0), P(3 * PX_PER_M, 4 * PX_PER_M)])).toBeCloseTo(
      7,
      9,
    );
    expect(polyLength([P(0, 0)])).toBe(0);
  });
});

describe("offsetPath", () => {
  it("a parallel keeps the point count and sits d away from the segment", () => {
    const pts = [P(0, 0), P(100, 0)];
    const off = offsetPath(pts, 7);
    expect(off).toHaveLength(2);
    expect(off.every((p: any) => distToLine(p, pts[0], pts[1]) === 7)).toBe(true);
    // The sign decides the side.
    expect(offsetPath(pts, 7)[0].y).toBe(7);
    expect(offsetPath(pts, -7)[0].y).toBe(-7);
  });

  it("a corner keeps its point count — the miter join meets at the vertex", () => {
    const pts = [P(0, 0), P(100, 0), P(100, 100)];
    const off = offsetPath(pts, 5);
    expect(off).toHaveLength(3);
    expect(distToLine(off[0], pts[0], pts[1])).toBeCloseTo(5, 9);
    expect(distToLine(off[2], pts[1], pts[2])).toBeCloseTo(5, 9);
    // A right angle mitres to the diagonal corner.
    expect(off[1].x).toBeCloseTo(95, 9);
    expect(off[1].y).toBeCloseTo(5, 9);
  });

  it("a hairpin is bevelled instead of shooting out of the trench", () => {
    const off = offsetPath([P(0, 0), P(100, 0), P(0, 0.5)], 5);
    // Bevel: two points at the corner rather than one far-out miter.
    expect(off).toHaveLength(4);
    expect(off.every((p: any) => Math.abs(p.x) < 200)).toBe(true);
  });

  it("without an offset, and with duplicate points, it just copies the route", () => {
    expect(offsetPath([P(3, 4), P(9, 9)], 0)).toEqual([P(3, 4), P(9, 9)]);
    expect(offsetPath([P(0, 0), P(0, 0), P(10, 0)], 2)).toHaveLength(2);
    expect(offsetPath([P(5, 5)], 3)).toEqual([P(5, 5)]);
  });
});

describe("pointAtLen and pathMid", () => {
  const pts = [P(0, 0), P(100, 0), P(100, 100)];

  it("walks the arc length, not the vertices", () => {
    expect(pointAtLen(pts, 0)).toMatchObject({ x: 0, y: 0, a: 0 });
    expect(pointAtLen(pts, 50)).toMatchObject({ x: 50, y: 0 });
    expect(pointAtLen(pts, 100)).toMatchObject({ x: 100, y: 0 });
    expect(pointAtLen(pts, 150)).toMatchObject({ x: 100, y: 50, a: 90 });
  });

  it("clamps beyond the end", () => {
    expect(pointAtLen(pts, 9999)).toMatchObject({ x: 100, y: 100 });
  });

  it("pathMid is the middle by length, not the middle waypoint", () => {
    const m = pathMid(pts);
    expect(m.x).toBeCloseTo(100, 9);
    expect(m.y).toBeCloseTo(0, 9);
    // Unequal legs: the midpoint lands on the long one.
    expect(pathMid([P(0, 0), P(10, 0), P(110, 0)]).x).toBeCloseTo(55, 9);
  });
});

describe("sectionOffsets", () => {
  const line = (len: number, at?: string) => [P(0, 0, at), P(len, 0)];

  it("one cross-section in the middle, then a comb every SECTION_STEP screen points", () => {
    const total = 1000;
    const out = sectionOffsets({}, line(total), 1);
    expect(out).toEqual([60, 280, 500, 720, 940]);
    // Sorted, inside the route, and clear of both ends.
    expect(out.every((o) => o >= SECTION_EDGE && o <= total - SECTION_EDGE)).toBe(true);
    expect([...out].sort((a, b) => a - b)).toEqual(out);
  });

  it("the zoom factor scales step and clearance alike", () => {
    expect(sectionOffsets({}, line(1000), 2)).toEqual([500]);
    expect(sectionOffsets({}, line(2000), 2)).toEqual([120, 560, 1000, 1440, 1880]);
    expect(sectionOffsets({}, line(1000), 1)).toHaveLength(5);
  });

  it("a route shorter than the clearance carries none", () => {
    expect(sectionOffsets({}, line(SECTION_EDGE - 1), 1)).toEqual([]);
    expect(sectionOffsets({}, line(100), 4)).toEqual([]);
  });

  it("keeps clear of a bound vertex — a marker sits there", () => {
    const pts = [P(0, 0), P(280, 0, "j1"), P(1000, 0)];
    const out = sectionOffsets({}, pts, 1);
    expect(out).not.toContain(280);
    expect(out.every((o) => Math.abs(o - 280) > SECTION_EDGE)).toBe(true);
    expect(out).toEqual([60, 500, 720, 940]);
    expect(SECTION_STEP).toBe(220);
  });

  it("the middle one is set before the clearance check and stays put", () => {
    // Known behaviour: only the comb around the middle runs through fits().
    expect(sectionOffsets({}, [P(0, 0), P(500, 0, "j1"), P(1000, 0)], 1)).toContain(500);
  });
});
