import { afterEach, describe, expect, it } from "vitest";
import {
  GEO,
  GEO_DEFAULT,
  e2px,
  n2px,
  px2e,
  px2n,
  stampGeo,
  unstampGeo,
  useGeo,
  UTM,
} from "../../src/planer/geo";

// GEO is module state — every test that moves the origin puts it back.
afterEach(() => useGeo(GEO_DEFAULT));

describe("UTM 32N (EPSG:25832)", () => {
  it("fwd hits the reference point to the metre", () => {
    const p = UTM.fwd(51, 6);
    expect(p.e).toBeCloseTo(289511.14, 0);
    expect(p.n).toBeCloseTo(5654109.2, 0);
    expect(Math.abs(p.e - 289511.14)).toBeLessThan(0.5);
    expect(Math.abs(p.n - 5654109.2)).toBeLessThan(0.5);
  });

  it("inv hits the reference point to a thousandth of a degree", () => {
    const g = UTM.inv(356558.82, 5645281.06);
    expect(Math.abs(g.lat - 50.94129)).toBeLessThan(0.001);
    expect(Math.abs(g.lon - 6.95828)).toBeLessThan(0.001);
  });

  it("fwd(inv(x)) comes back to the millimetre", () => {
    for (const [e, n] of [
      [356448.6, 5645366.7],
      [289511.14, 5654109.2],
      [500000, 5400000],
    ]) {
      const g = UTM.inv(e, n);
      const p = UTM.fwd(g.lat, g.lon);
      expect(Math.abs(p.e - e)).toBeLessThan(0.001);
      expect(Math.abs(p.n - n)).toBeLessThan(0.001);
    }
  });
});

describe("GEO_DEFAULT", () => {
  it("is Cologne Cathedral — the public default origin, never a private place", () => {
    expect(GEO_DEFAULT).toEqual({ e0: 356448.6, n0: 5645366.7 });
    const g = UTM.inv(GEO_DEFAULT.e0, GEO_DEFAULT.n0);
    expect(g.lat).toBeCloseTo(50.94, 2);
    expect(g.lon).toBeCloseTo(6.958, 2);
  });
});

describe("pixel <-> metre", () => {
  it("px2e/px2n and back are inverses of each other", () => {
    expect(px2e(0)).toBe(GEO.e0);
    expect(px2n(0)).toBe(GEO.n0);
    // 150 dpi: one metre is 150/25.4 pixels, and y runs the other way than north.
    expect(px2e(GEO.pxPerM)).toBeCloseTo(GEO.e0 + 1, 9);
    expect(px2n(GEO.pxPerM)).toBeCloseTo(GEO.n0 - 1, 9);
    expect(e2px(px2e(123.5))).toBeCloseTo(123.5, 6);
    expect(n2px(px2n(-77.25))).toBeCloseTo(-77.25, 6);
  });

  it("useGeo moves the origin and reports whether it moved", () => {
    expect(useGeo({ e0: 400000, n0: 5600000 })).toBe(true);
    expect(useGeo({ e0: 400000, n0: 5600000 })).toBe(false);
    expect(px2e(0)).toBe(400000);
    // Junk falls back to the default origin.
    expect(useGeo({ e0: "x", n0: null })).toBe(true);
    expect(GEO.e0).toBe(GEO_DEFAULT.e0);
  });
});

describe("stampGeo / unstampGeo", () => {
  const plan = () => ({
    items: [{ id: "a", x: 100, y: 250 }],
    conduits: [
      {
        points: [
          { x: 0, y: 0 },
          { x: 300.4, y: -12.5 },
        ],
      },
    ],
  });

  it("round-trips x/y through e/n", () => {
    const st: any = stampGeo(plan());
    expect(st.items[0].e).toBeCloseTo(px2e(100), 2);
    expect(st.items[0].n).toBeCloseTo(px2n(250), 2);
    unstampGeo(st);
    // Stored to the centimetre, read back to a tenth of a pixel.
    expect(st.items[0].x).toBeCloseTo(100, 1);
    expect(st.items[0].y).toBeCloseTo(250, 1);
    expect(st.conduits[0].points[1].x).toBeCloseTo(300.4, 1);
    expect(st.conduits[0].points[1].y).toBeCloseTo(-12.5, 1);
  });

  it("a different origin moves the pixels, the metres stay put", () => {
    const st: any = stampGeo(plan());
    const { e, n } = st.items[0];
    useGeo({ e0: GEO_DEFAULT.e0 + 100, n0: GEO_DEFAULT.n0 });
    unstampGeo(st);
    expect(st.items[0].e).toBe(e);
    expect(st.items[0].n).toBe(n);
    expect(st.items[0].x).toBeCloseTo(100 - 100 * GEO.pxPerM, 1);
  });

  it("leaves a point without e/n alone", () => {
    const st: any = unstampGeo({ items: [{ x: 5, y: 7 }], conduits: [] });
    expect(st.items[0]).toEqual({ x: 5, y: 7 });
    expect(() => unstampGeo({})).not.toThrow();
    expect(() => stampGeo({})).not.toThrow();
  });
});
