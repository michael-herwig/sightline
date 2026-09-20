import { beforeEach, describe, expect, it } from "vitest";
import { CONDUITS, PIPES } from "../../src/planer/catalogs";
import {
  condCables,
  condName,
  condPipes,
  isAutoLabel,
  isCableRun,
  pipeRate,
} from "../../src/planer/conduit";
import { setLangValue } from "../../src/planer/i18n";

// Fixtures stay loose on purpose: several of these are deliberately malformed.
const trench = (ducts: any[]): any => ({ kind: "trench", ducts });
const run = (cables: any[]): any => ({ kind: "cable", ducts: [{ cables }] });

beforeEach(() => setLangValue("de"));

describe("condCables", () => {
  it("is the union over all ducts, summed per type", () => {
    const c = trench([
      {
        pipe: "dn50",
        cables: [
          { type: "cat", n: 1 },
          { type: "fiber", n: 2 },
        ],
      },
      { pipe: "dn50", cables: [{ type: "cat", n: 3 }] },
      { pipe: "dn63", cables: [] },
    ]);
    // Order follows CABLE_ORDER (fibre → copper → power), not the duct order.
    expect(condCables(c)).toEqual([
      { type: "fiber", n: 2 },
      { type: "cat", n: 4 },
    ]);
  });

  it("drops unknown types and empty counts", () => {
    const c = trench([
      {
        pipe: "dn50",
        cables: [
          { type: "beam", n: 2 },
          { type: "cat", n: 0 },
        ],
      },
    ]);
    expect(condCables(c)).toEqual([]);
    expect(condCables({} as any)).toEqual([]);
  });
});

describe("condPipes and pipeRate", () => {
  it("counts the ducts per type in the order of PIPES", () => {
    const c = trench([{ pipe: "dn63" }, { pipe: "dn50" }, { pipe: "dn63" }]);
    expect(condPipes(c)).toEqual([
      { pipe: "dn50", n: 1 },
      { pipe: "dn63", n: 2 },
    ]);
    expect(pipeRate(c)).toBeCloseTo(PIPES.dn50.m + 2 * PIPES.dn63.m, 10);
  });

  it("an unknown duct type counts as DN 50", () => {
    expect(condPipes(trench([{ pipe: "dn999" }]))).toEqual([{ pipe: "dn50", n: 1 }]);
  });

  it("a cable run has no ducts and therefore no duct rate", () => {
    const c = run([{ type: "cat", n: 2 }]);
    expect(isCableRun(c)).toBe(true);
    expect(condPipes(c)).toEqual([]);
    expect(pipeRate(c)).toBe(0);
    expect(isCableRun(trench([{ pipe: "dn50" }]))).toBe(false);
  });
});

describe("condName", () => {
  it("one duct keeps the plain name, several put the count in front", () => {
    expect(condName(trench([{ pipe: "dn50", cables: [{ type: "cat", n: 1 }] }]))).toBe(
      "Leerrohr DN 50 + 1 × Cat6A",
    );
    expect(condName(trench([{ pipe: "dn50" }, { pipe: "dn63" }]))).toBe(
      "1 × Leerrohr DN 50 + 1 × Leerrohr DN 63",
    );
  });

  it("a trench without cables is just the duct", () => {
    expect(condName(trench([{ pipe: "dn63" }]))).toBe("Leerrohr DN 63");
  });

  it("a cable run names the bundle, an empty one a dash", () => {
    expect(condName(run([{ type: "cat", n: 2 }]))).toBe("2 × Cat6A (ohne Rohr)");
    expect(condName(run([]))).toBe("– (ohne Rohr)");
  });

  it("follows the language", () => {
    setLangValue("en");
    expect(condName(trench([{ pipe: "dn50", cables: [{ type: "fiber", n: 1 }] }]))).toBe(
      "Conduit DN 50 + 1 × Fibre SM, 4 cores",
    );
  });
});

describe("isAutoLabel", () => {
  const c = trench([{ pipe: "dn50", cables: [{ type: "cat", n: 1 }] }]);

  it("empty, a template name or condName() itself is automatic", () => {
    expect(isAutoLabel({ ...c, label: "" })).toBe(true);
    expect(isAutoLabel({ ...c, label: "   " })).toBe(true);
    expect(isAutoLabel({ ...c })).toBe(true);
    expect(isAutoLabel({ ...c, label: (CONDUITS.fiber.name as { de: string }).de })).toBe(true);
    expect(isAutoLabel({ ...c, label: (CONDUITS.fiber.name as { en: string }).en })).toBe(true);
    expect(isAutoLabel({ ...c, label: condName(c) })).toBe(true);
  });

  it("a name someone typed stays", () => {
    expect(isAutoLabel({ ...c, label: "Stamm" })).toBe(false);
    // Once it no longer matches the contents it is no longer the automatic name.
    expect(isAutoLabel({ ...trench([{ pipe: "dn63" }]), label: condName(c) })).toBe(false);
  });
});
