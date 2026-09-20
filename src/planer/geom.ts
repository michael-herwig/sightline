// @ts-nocheck
// Pure geometry: lengths, angles, offset paths, points along a path.
import { PX_PER_M } from "./geo";

// ---------- Costs ----------
export function polyLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++)
    l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return l / PX_PER_M;
}

// Angle of a point around a center in degrees, normalized to 0..359.
// snap > 0 snaps to steps (Shift while rotating).
export function angleAt(cx, cy, x, y, snap) {
  let a = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
  if (snap) a = Math.round(a / snap) * snap;
  return ((Math.round(a) % 360) + 360) % 360;
}

// Parallel to a polyline: offset each segment by d and intersect the offset
// lines at the corners (miter join). A very sharp corner would otherwise shoot
// far out of the trench — beyond four times the offset it's beveled instead.
// d is in map units, not screen points: this is geometry, not a stroke.
export function offsetPath(pts, d) {
  const P = pts.filter((p, i) => !i || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 1e-6);
  if (P.length < 2 || !d) return P.map((p) => ({ x: p.x, y: p.y }));
  const seg = [];
  for (let i = 1; i < P.length; i++) {
    const dx = P[i].x - P[i - 1].x,
      dy = P[i].y - P[i - 1].y,
      L = Math.hypot(dx, dy),
      ux = dx / L,
      uy = dy / L;
    seg.push({
      ax: P[i - 1].x - uy * d,
      ay: P[i - 1].y + ux * d,
      bx: P[i].x - uy * d,
      by: P[i].y + ux * d,
      ux,
      uy,
    });
  }
  const out = [{ x: seg[0].ax, y: seg[0].ay }];
  for (let i = 1; i < seg.length; i++) {
    const s0 = seg[i - 1],
      s1 = seg[i],
      cr = s0.ux * s1.uy - s0.uy * s1.ux;
    if (Math.abs(cr) < 1e-9) {
      out.push({ x: s0.bx, y: s0.by });
      continue;
    }
    const t = ((s1.ax - s0.ax) * s1.uy - (s1.ay - s0.ay) * s1.ux) / cr;
    const mx = s0.ax + s0.ux * t,
      my = s0.ay + s0.uy * t;
    if (Math.hypot(mx - P[i].x, my - P[i].y) > 4 * Math.abs(d))
      out.push({ x: s0.bx, y: s0.by }, { x: s1.ax, y: s1.ay });
    else out.push({ x: mx, y: my });
  }
  const last = seg[seg.length - 1];
  out.push({ x: last.bx, y: last.by });
  return out;
}

export const dOf = (ps) =>
  ps.map((p, i) => (i ? "L" : "M") + p.x.toFixed(2) + " " + p.y.toFixed(2)).join(" ");

// ---------- Cross-sections ----------
// A picture of what's in the trench: one circle per duct, side by side along the
// route, with the cables inside as colored dots. Pure display — how many circles
// are shown and where they sit depends on zoom and is nowhere in `state`.
export const CSEC_R = 9,
  SECTION_STEP = 220,
  SECTION_EDGE = 40;

// Arc lengths of the vertices, for placement search and point-on-route lookups.
function arcLens(pts) {
  const acc = [0];
  for (let i = 1; i < pts.length; i++)
    acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return acc;
}

// Point and direction at a position on the route (arc length in map units).
export function pointAtLen(pts, o) {
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i],
      d = Math.hypot(b.x - a.x, b.y - a.y);
    if (run + d >= o || i === pts.length - 1) {
      const u = d ? Math.max(0, Math.min(1, (o - run) / d)) : 0;
      return {
        x: a.x + u * (b.x - a.x),
        y: a.y + u * (b.y - a.y),
        a: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      };
    }
    run += d;
  }
  return { x: pts[0].x, y: pts[0].y, a: 0 };
}

// Where cross-sections belong: one at the middle, then more to the left and right every
// 220 screen points — a comb around the middle. The first and last 40 px
// stay clear, as do 40 px around every bound vertex: a marker sits there.
export function sectionOffsets(c, pts, k) {
  const acc = arcLens(pts),
    total = acc[acc.length - 1];
  if (total / k < SECTION_EDGE) return [];
  const out = [total / 2];
  const busy = pts.map((p, i) => (p.at ? acc[i] : -1)).filter((v) => v >= 0);
  const edge = SECTION_EDGE * k;
  const fits = (o) => o >= edge && o <= total - edge && busy.every((b) => Math.abs(o - b) > edge);
  for (let d = SECTION_STEP * k; ; d += SECTION_STEP * k) {
    const a = total / 2 - d,
      b = total / 2 + d;
    if (a < edge && b > total - edge) break;
    if (fits(a)) out.push(a);
    if (fits(b)) out.push(b);
  }
  return out.sort((x, y) => x - y);
}

// Midpoint of the route by length, not the middle waypoint — otherwise the
// jump lands somewhere along the way instead of the middle. `a` is the direction of
// the segment there, in degrees: the cross-section attaches to it next to the line.
export function pathMid(pts) {
  const acc = arcLens(pts);
  return pointAtLen(pts, acc[acc.length - 1] / 2);
}
