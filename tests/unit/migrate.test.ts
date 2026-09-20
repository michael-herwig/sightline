import { describe, expect, it } from "vitest";
import { migrateConduit, migrateJb } from "../../src/planer/migrate";

// Share links from earlier builds still carry the old shapes — this path must stay.

describe("migrateConduit", () => {
  it("very old: catalogue template plus a cable count", () => {
    const c: any = migrateConduit({ type: "fiber", cables: 2, points: [] });
    expect(c.kind).toBe("trench");
    expect(c.ducts).toEqual([{ pipe: "dn50", cables: [{ type: "fiber", n: 2 }] }]);
    expect(c.type).toBeUndefined();
    expect(c.cables).toBeUndefined();
    expect(c.pipe).toBeUndefined();
  });

  it("very old with a count of 0 leaves the duct empty", () => {
    const c: any = migrateConduit({ type: "cat", cables: 0 });
    expect(c.ducts).toEqual([{ pipe: "dn50", cables: [] }]);
  });

  it("flat: one duct type, a duct count, cables with no duct assignment", () => {
    const c: any = migrateConduit({ pipe: "dn63", ducts: 3, cables: [{ type: "cat", n: 1 }] });
    expect(c.kind).toBe("trench");
    // Every duct inherits the old type, all the cables land in duct 1.
    expect(c.ducts).toEqual([
      { pipe: "dn63", cables: [{ type: "cat", n: 1 }] },
      { pipe: "dn63", cables: [] },
      { pipe: "dn63", cables: [] },
    ]);
  });

  it("one duct type per trench: the ducts inherit the conduit's pipe", () => {
    const c: any = migrateConduit({
      pipe: "dn63",
      ducts: [{ cables: [{ type: "cat", n: 1 }] }, { cables: [] }],
    });
    expect(c.ducts.map((d: any) => d.pipe)).toEqual(["dn63", "dn63"]);
    expect(c.ducts[0].cables).toEqual([{ type: "cat", n: 1 }]);
  });

  it("current shape: type per duct, nothing changes", () => {
    const c: any = migrateConduit({
      kind: "trench",
      ducts: [
        { pipe: "dn50", cables: [{ type: "fiber", n: 2 }] },
        { pipe: "dn63", cables: [] },
      ],
    });
    expect(c.kind).toBe("trench");
    expect(c.ducts).toEqual([
      { pipe: "dn50", cables: [{ type: "fiber", n: 2 }] },
      { pipe: "dn63", cables: [] },
    ]);
  });

  it('pipe "none" becomes the cable run: one bundle, no duct', () => {
    const c: any = migrateConduit({
      pipe: "none",
      ducts: [{ cables: [{ type: "cat", n: 2 }] }, { cables: [{ type: "cat", n: 1 }] }],
    });
    expect(c.kind).toBe("cable");
    // One bundle carrying the union — and no pipe on it.
    expect(c.ducts).toEqual([{ cables: [{ type: "cat", n: 3 }] }]);
    expect(c.ducts[0].pipe).toBeUndefined();
  });

  it('kind "cable" collapses several ducts into one bundle as well', () => {
    const c: any = migrateConduit({
      kind: "cable",
      ducts: [{ cables: [{ type: "fiber", n: 1 }] }, { cables: [{ type: "cat", n: 2 }] }],
    });
    expect(c.ducts).toEqual([
      {
        cables: [
          { type: "fiber", n: 1 },
          { type: "cat", n: 2 },
        ],
      },
    ]);
  });

  it("an empty conduit still has exactly one DN 50 duct", () => {
    expect(migrateConduit({}).ducts).toEqual([{ pipe: "dn50", cables: [] }]);
    expect(migrateConduit({ kind: "trench", ducts: [] }).ducts).toEqual([
      { pipe: "dn50", cables: [] },
    ]);
  });

  it("never more than six ducts, and unknown pipe types fall back to DN 50", () => {
    expect(migrateConduit({ pipe: "dn50", ducts: 9, cables: [] }).ducts).toHaveLength(6);
    expect(migrateConduit({ ducts: Array.from({ length: 8 }, () => ({})) }).ducts).toHaveLength(6);
    expect(migrateConduit({ pipe: "dn999", ducts: [{ pipe: "nope" }] }).ducts[0].pipe).toBe("dn50");
  });

  it("cables are sanitised: unknown types out, count clamped to 1..12", () => {
    const c: any = migrateConduit({
      kind: "trench",
      ducts: [
        {
          pipe: "dn50",
          cables: [
            { type: "beam", n: 1 },
            { type: "cat", n: 99 },
            { type: "fiber", n: 0 },
          ],
        },
      ],
    });
    expect(c.ducts[0].cables).toEqual([
      { type: "cat", n: 12 },
      { type: "fiber", n: 1 },
    ]);
  });
});

describe("migrateJb", () => {
  it("a device sitting in model moves into gear, the point becomes indoor", () => {
    const it: any = migrateJb({ kind: "jb", model: "flex", label: "S" });
    expect(it.model).toBe("indoor");
    expect(it.gear).toEqual([{ model: "flex", n: 1 }]);
  });

  it("a housing keeps its model and its gear", () => {
    const it: any = migrateJb({ kind: "jb", model: "shaft", gear: [{ model: "conv", n: 2 }] });
    expect(it.model).toBe("shaft");
    expect(it.gear).toEqual([{ model: "conv", n: 2 }]);
  });

  it("the old model goes in front of gear that is already there", () => {
    const it: any = migrateJb({ kind: "jb", model: "flex", gear: [{ model: "splice", n: 1 }] });
    expect(it.gear).toEqual([
      { model: "flex", n: 1 },
      { model: "splice", n: 1 },
    ]);
  });

  it("an unknown model becomes an empty indoor point, junk gear is dropped", () => {
    const it: any = migrateJb({ kind: "jb", model: "gone", gear: [{ model: "nope", n: 1 }] });
    expect(it.model).toBe("indoor");
    expect(it.gear).toEqual([]);
  });

  it("gear counts are clamped to at least one", () => {
    expect(migrateJb({ model: "shaft", gear: [{ model: "conv", n: 0 }] }).gear).toEqual([
      { model: "conv", n: 1 },
    ]);
    expect(migrateJb({ model: "shaft", gear: "nope" }).gear).toEqual([]);
  });

  it("an empty point stays a valid, purely logical location", () => {
    const it: any = migrateJb({ kind: "jb", model: "indoor" });
    expect(it.model).toBe("indoor");
    expect(it.gear).toEqual([]);
  });
});
