import { describe, expect, it } from "vitest";
import { powerPlan } from "../e2e/fixtures";
import { jbCap, jbPorts } from "../../src/planer/gear";

const byLabel = (label: string): any =>
  (powerPlan.items as any[]).find((i: any) => i.label === label);

const cap = (model: string) => jbCap({ gear: [{ model, n: 1 }] } as any);

describe("ports at a point", () => {
  it("a PoE-fed switch counts its own ports — no PoE out does not mean no ports", () => {
    // P1 is a shaft holding one USW Flex Mini: 5 ports, none of them PoE.
    expect(jbPorts(byLabel("P1"))).toBe(5);
  });

  it("a switch port works both ways: an uplink lands on it like a camera", () => {
    expect(cap("lite8")).toEqual({ down: 8, up: 8, total: 8 });
  });

  it("a PoE-in port takes the uplink but feeds nothing", () => {
    // USW Ultra 60W: seven PoE+ ports plus the port it is powered through.
    expect(cap("usw-ultra-60w")).toEqual({ down: 7, up: 8, total: 8 });
  });

  it("an injector is directional: data in on one jack, PoE out on the other", () => {
    expect(cap("u-poe-plus-plus")).toEqual({ down: 1, up: 1, total: 2 });
  });

  it("a media converter has one port on each side, both of them usable either way", () => {
    expect(cap("conv")).toEqual({ down: 1, up: 1, total: 1 });
  });

  it("a converter next to a switch adds nothing — its port feeds the switch", () => {
    expect(
      jbPorts({
        gear: [
          { model: "conv", n: 1 },
          { model: "lite8", n: 1 },
        ],
      } as any),
    ).toBe(8);
  });
});
