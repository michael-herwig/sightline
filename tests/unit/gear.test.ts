import { describe, expect, it } from "vitest";
import { powerPlan } from "../e2e/fixtures";
import { jbPorts } from "../../src/planer/gear";

const byLabel = (label: string): any =>
  (powerPlan.items as any[]).find((i: any) => i.label === label);

describe("jbPorts", () => {
  it("a PoE-fed switch counts its own ports — poePorts: 0 means no PoE out, not no ports", () => {
    // P1 is a shaft holding one USW Flex Mini: 5 ports, none of them PoE.
    expect(jbPorts(byLabel("P1"))).toBe(5);
  });

  it("an injector counts what goes onward, not both of its jacks", () => {
    expect(jbPorts({ gear: [{ model: "u-poe-plus-plus", n: 1 }] } as any)).toBe(1);
  });
});
