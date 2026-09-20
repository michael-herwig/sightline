import { beforeEach, describe, expect, it } from "vitest";
import { APS, CABLES, CAMS, INFRA, JUNCTIONS, PIPES } from "../../src/planer/catalogs";
import { conduitCost, costs } from "../../src/planer/costs";
import { defaultState, setState } from "../../src/planer/store";

// 10 m on the map: PX_PER_M = 5.957.
const TEN_M = 59.57;
const line = [
  { x: 0, y: 0 },
  { x: TEN_M, y: 0 },
];

// Fixtures stay loose on purpose: several of these are deliberately malformed.
const trench = (ducts: any[], points = line): any => ({ kind: "trench", ducts, points });
const run = (cables: any[], points = line): any => ({
  kind: "cable",
  ducts: [{ cables }],
  points,
});

function load(patch: any = {}) {
  const st: any = { ...defaultState(), ...patch };
  setState(st);
  return st;
}

beforeEach(() => load());

describe("conduitCost", () => {
  it("charges every duct by its own type, plus earthwork per metre of trench", () => {
    load({ earthwork: 12 });
    const c = conduitCost(trench([{ pipe: "dn50" }, { pipe: "dn63" }, { pipe: "dn50" }]));
    expect(c.len).toBeCloseTo(10, 6);
    expect(c.pipe).toBeCloseTo(10 * (2 * PIPES.dn50.m + PIPES.dn63.m), 6);
    expect(c.earth).toBeCloseTo(120, 6);
    expect(c.cable).toBe(0);
    expect(c.fixed).toBe(0);
    expect(c.total).toBeCloseTo(c.pipe + c.earth, 6);
  });

  it("cables cost per metre and once per cable, summed over all ducts", () => {
    const c = conduitCost(
      trench([
        { pipe: "dn50", cables: [{ type: "cat", n: 2 }] },
        { pipe: "dn50", cables: [{ type: "fiber", n: 1 }] },
      ]),
    );
    expect(c.cable).toBeCloseTo(10 * (2 * CABLES.cat.m + CABLES.fiber.m), 6);
    expect(c.fixed).toBeCloseTo(2 * CABLES.cat.fixed + CABLES.fiber.fixed, 6);
  });

  it("a cable run has neither duct nor trench — only the cable counts", () => {
    load({ earthwork: 99 });
    const c = conduitCost(run([{ type: "cat", n: 1 }]));
    expect(c.pipe).toBe(0);
    expect(c.earth).toBe(0);
    expect(c.total).toBeCloseTo(10 * CABLES.cat.m + CABLES.cat.fixed, 6);
  });
});

describe("costs()", () => {
  const plan = () => ({
    earthwork: 10,
    items: [
      { id: "h1", kind: "hub", label: "H1", x: 0, y: 0, gear: [{ model: "flex", n: 1 }] },
      { id: "k1", kind: "cam", model: "g6-bullet", label: "K1", x: 10, y: 0 },
      { id: "k2", kind: "cam", model: "g5-bullet", label: "K2", x: 20, y: 0 },
      { id: "a1", kind: "ap", model: "u7-pro", label: "A1", x: 30, y: 0 },
      {
        id: "j1",
        kind: "jb",
        model: "shaft",
        label: "J1",
        x: 40,
        y: 0,
        gear: [{ model: "conv", n: 2 }],
      },
    ],
    conduits: [
      trench([{ pipe: "dn50", cables: [{ type: "cat", n: 1 }] }]),
      run([{ type: "cat", n: 1 }]),
    ],
    infra: { ...defaultState().infra, ucg: { on: true, qty: 2 }, unvr: { on: false, qty: 1 } },
  });

  it("groups the elements and sums each group", () => {
    load(plan());
    const c = costs();
    expect(c.cams.map((i: any) => i.id)).toEqual(["k1", "k2"]);
    expect(c.aps.map((i: any) => i.id)).toEqual(["a1"]);
    expect(c.jbs.map((i: any) => i.id)).toEqual(["j1"]);
    expect(c.hubs.map((i: any) => i.id)).toEqual(["h1"]);
    expect(c.sumCams).toBeCloseTo(CAMS["g6-bullet"].price + CAMS["g5-bullet"].price, 6);
    expect(c.sumAps).toBeCloseTo(APS["u7-pro"].price, 6);
  });

  it("a point costs its housing plus its gear, the hub only its gear", () => {
    load(plan());
    const c = costs();
    const jb = JUNCTIONS.shaft.price + 2 * JUNCTIONS.conv.price;
    expect(c.jbs[0].price).toBeCloseTo(jb, 6);
    expect(c.hubs[0].price).toBeCloseTo(JUNCTIONS.flex.price, 6);
    // Both land in the same bucket.
    expect(c.sumJbs).toBeCloseTo(jb + JUNCTIONS.flex.price, 6);
  });

  it("head-end entries count only when switched on, with a quantity", () => {
    load(plan());
    const c = costs();
    expect(c.infra.map((i: any) => i.id)).toEqual(["ucg"]);
    expect(c.sumInfra).toBeCloseTo(2 * INFRA.find((i) => i.id === "ucg")!.price, 6);
  });

  it("the total is the sum of the five buckets", () => {
    load(plan());
    const c = costs();
    expect(c.sumCond).toBeCloseTo(
      c.conds.reduce((a: number, b: any) => a + b.c.total, 0),
      6,
    );
    expect(c.total).toBeCloseTo(c.sumCams + c.sumAps + c.sumJbs + c.sumCond + c.sumInfra, 6);
  });

  it("splits the cameras into 4K and the rest — that is the NVR budget", () => {
    load(plan());
    const c = costs();
    expect(c.n4k).toBe(1);
    expect(c.n2k).toBe(1);
  });

  it("an empty plan costs nothing", () => {
    load();
    const c = costs();
    expect(c.total).toBe(0);
    expect(c.infra).toEqual([]);
  });
});
