// Sheet geometry and EPSG:25832: the plan box, GEO, UTM, pixel <-> meter.
import type { Geo, Placed, Stampable } from "./types";

// ---------- Geometry ----------
// Cadastral extract 1:1000 rendered at 150 dpi: 100 m = 595.7 px.
export const PX_PER_M = 5.957;

export const W = 1302,
  H = 1011;

// ---------- Map base layer ----------
// The pixel coordinates of the elements are a plain linear mapping to
// EPSG:25832 — the view may therefore leave the property, the tile is
// simply fetched for the current viewport.
// Note: PX_PER_M above uses 5.957, see README (scale section).
// Grid anchor of the plan: plan pixel (0,0) in EPSG:25832. Stored per plan (state.geo),
// so each plan has its own origin. Default with no location reference: Cologne Cathedral at the center.
export const GEO_DEFAULT = { e0: 356448.6, n0: 5645366.7 };

export const GEO = { e0: GEO_DEFAULT.e0, n0: GEO_DEFAULT.n0, pxPerM: 150 / 25.4 };

export function useGeo(g: Partial<Record<keyof Geo, unknown>> | null | undefined) {
  const e0 = g && Number.isFinite(Number(g.e0)) ? Number(g.e0) : GEO_DEFAULT.e0,
    n0 = g && Number.isFinite(Number(g.n0)) ? Number(g.n0) : GEO_DEFAULT.n0;
  const moved = e0 !== GEO.e0 || n0 !== GEO.n0;
  GEO.e0 = e0;
  GEO.n0 = n0;
  return moved;
}

// New origin so that the location lies at the center of the plan.
export const geoAround = (e: number, n: number) => ({
  e0: +(e - W / 2 / GEO.pxPerM).toFixed(2),
  n0: +(n + H / 2 / GEO.pxPerM).toFixed(2),
});

export const px2e = (x: number) => GEO.e0 + x / GEO.pxPerM;

export const px2n = (y: number) => GEO.n0 - y / GEO.pxPerM;

export const bboxOf = (x: number, y: number, w: number, h: number) =>
  [px2e(x), px2n(y + h), px2e(x + w), px2n(y)].map((v) => v.toFixed(2)).join(",");

// Without a plan there is no "home". The start viewport is deliberately wide —
// you see an area, not a property. ⌂ then adjusts to your own plan.
const START_SPAN_M = 2500;

export const HOME = (() => {
  const w = START_SPAN_M * GEO.pxPerM;
  return { x: W / 2 - w / 2, y: H / 2 - w / 2, w, h: w };
})();

// ---------- Location search ----------
// WGS84 <-> UTM 32N (EPSG:25832), standard transverse Mercator. Meter-accurate,
// a 1:1000 plan doesn't need more — and it saves a proj library.
export const UTM = (() => {
  const a = 6378137,
    f = 1 / 298.257223563,
    k0 = 0.9996,
    lon0 = (9 * Math.PI) / 180,
    E0 = 500000;
  const e2 = f * (2 - f),
    ep2 = e2 / (1 - e2),
    rad = Math.PI / 180;
  const pow = Math.pow,
    sin = Math.sin,
    cos = Math.cos,
    tan = Math.tan,
    sqrt = Math.sqrt;
  function fwd(lat: number, lon: number) {
    const p = lat * rad,
      l = lon * rad;
    const N = a / sqrt(1 - e2 * pow(sin(p), 2));
    const T = pow(tan(p), 2),
      C = ep2 * pow(cos(p), 2),
      A = cos(p) * (l - lon0);
    const M =
      a *
      ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * pow(e2, 3)) / 256) * p -
        ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * pow(e2, 3)) / 1024) * sin(2 * p) +
        ((15 * e2 * e2) / 256 + (45 * pow(e2, 3)) / 1024) * sin(4 * p) -
        ((35 * pow(e2, 3)) / 3072) * sin(6 * p));
    return {
      e:
        E0 +
        k0 *
          N *
          (A +
            ((1 - T + C) * pow(A, 3)) / 6 +
            ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * pow(A, 5)) / 120),
      n:
        k0 *
        (M +
          N *
            tan(p) *
            ((A * A) / 2 +
              ((5 - T + 9 * C + 4 * C * C) * pow(A, 4)) / 24 +
              ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * pow(A, 6)) / 720)),
    };
  }
  function inv(e: number, n: number) {
    const x = e - E0,
      e1 = (1 - sqrt(1 - e2)) / (1 + sqrt(1 - e2));
    const mu = n / k0 / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * pow(e2, 3)) / 256));
    const p1 =
      mu +
      ((3 * e1) / 2 - (27 * pow(e1, 3)) / 32) * sin(2 * mu) +
      ((21 * e1 * e1) / 16 - (55 * pow(e1, 4)) / 32) * sin(4 * mu) +
      ((151 * pow(e1, 3)) / 96) * sin(6 * mu);
    const C1 = ep2 * pow(cos(p1), 2),
      T1 = pow(tan(p1), 2);
    const N1 = a / sqrt(1 - e2 * pow(sin(p1), 2));
    const R1 = (a * (1 - e2)) / pow(1 - e2 * pow(sin(p1), 2), 1.5);
    const D = x / (N1 * k0);
    const lat =
      p1 -
      ((N1 * tan(p1)) / R1) *
        ((D * D) / 2 -
          ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * pow(D, 4)) / 24 +
          ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * pow(D, 6)) / 720);
    const lon =
      lon0 +
      (D -
        ((1 + 2 * T1 + C1) * pow(D, 3)) / 6 +
        ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * pow(D, 5)) / 120) /
        cos(p1);
    return { lat: lat / rad, lon: lon / rad };
  }
  return { fwd, inv };
})();

export const e2px = (e: number) => (e - GEO.e0) * GEO.pxPerM;

export const n2px = (n: number) => (GEO.n0 - n) * GEO.pxPerM;

export const pxLatLon = (x: number, y: number) => UTM.inv(px2e(x), px2n(y));

// Position in meters (EPSG:25832) on every element and conduit point: that's what gets saved
// and shared. x/y are just the pixel cache for it and get recomputed from e/n whenever
// a plan's raster origin differs. That way nothing drifts with the origin anymore.
export function stampGeo<T extends Stampable>(st: T): T {
  const put = (o: Placed) => {
    o.e = +px2e(o.x).toFixed(2);
    o.n = +px2n(o.y).toFixed(2);
  };
  (st.items || []).forEach(put);
  (st.conduits || []).forEach((c) => (c.points || []).forEach(put));
  return st;
}

export function unstampGeo<T extends Stampable>(st: T): T {
  const take = (o: Placed) => {
    const e = Number(o.e),
      n = Number(o.n);
    if (Number.isFinite(e) && Number.isFinite(n)) {
      o.x = +e2px(e).toFixed(1);
      o.y = +n2px(n).toFixed(1);
    }
  };
  (st.items || []).forEach(take);
  (st.conduits || []).forEach((c) => (c.points || []).forEach(take));
  return st;
}
