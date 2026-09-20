import { beforeEach, describe, expect, it } from "vitest";
import { legacyPlan, linkPlan, powerPlan } from "../e2e/fixtures";
import { JUNCTIONS } from "../../src/planer/catalogs";
import { invalidateLinks, links } from "../../src/planer/links";
import { migrateConduit, migrateJb } from "../../src/planer/migrate";
import { defaultState, setState, state } from "../../src/planer/store";
import { setLangValue, t } from "../../src/planer/i18n";

// The same scenarios as tests/e2e/links.spec.ts, but on the status keys and the
// PoE/port numbers instead of the rendered German sentences.

/** What adopt() does to a loaded plan, minus everything that needs a DOM. */
function load(plan: any) {
  const d: any = defaultState();
  const st: any = { ...d, ...structuredClone(plan), infra: { ...d.infra, ...plan.infra } };
  setState(st);
  st.conduits.forEach(migrateConduit);
  st.items.forEach((i: any) => {
    if (i.kind === "jb") migrateJb(i);
    else if (i.kind === "hub" && !Array.isArray(i.gear)) i.gear = [];
  });
  invalidateLinks();
  return st;
}

const S = (): any => state;
const byLabel = (label: string): any => S().items.find((i: any) => i.label === label);
// Loose on purpose: every lookup here is asserted right after, and a `!` on
// each of the sixty call sites would only add noise.
const st = (label: string): any => links().status.get(byLabel(label).id);
const gear = (label: string): any => links().gear.get(byLabel(label).id);
const src = (label: string): any => links().src.get(byLabel(label).id);
const keys = (s: any) => (s ? [s.key, ...(s.more || []).map((m: any) => m.key)] : []);

beforeEach(() => {
  setLangValue("de");
  invalidateLinks();
});

describe("Topology (linkPlan)", () => {
  beforeEach(() => load(linkPlan));

  it("ok: the camera on the switch names source and distance", () => {
    expect(st("K1")).toMatchObject({ g: "ok", key: "link.ok", vars: { src: "S1", len: "40" } });
    expect(src("K1").len).toBeCloseTo(40, 6);
  });

  it("long: over 90 m of Cat6A replaces the ok finding", () => {
    expect(st("KL")).toMatchObject({ g: "warn", key: "link.long", vars: { len: "110" } });
    expect(keys(st("KL"))).toEqual(["link.long"]);
    // Still connected — the source is known, only the run is too long.
    expect(src("KL").src.label).toBe("S1");
  });

  it("none: no cable at all", () => {
    expect(st("K2")).toMatchObject({ g: "err", key: "link.none" });
    expect(src("K2")).toBeUndefined();
  });

  it("nopoe: the media converter delivers no PoE", () => {
    expect(st("K9")).toMatchObject({ g: "warn", key: "link.nopoe", vars: { src: "C1" } });
    expect(gear("C1")).toMatchObject({ poe: 0, ports: 1, over: true });
  });

  it("a Wi-Fi camera gets no finding at all", () => {
    expect(st("K3")).toBeUndefined();
  });

  it("fiber: fiber straight into the camera is its own error", () => {
    expect(st("KF")).toMatchObject({ g: "err", key: "link.fiber" });
  });

  it("deadup: connected is not supplied — each side reports its own part", () => {
    expect(st("K4")).toMatchObject({ g: "err", key: "link.deadup", vars: { pt: "S4" } });
    expect(st("S4")).toMatchObject({ g: "warn", key: "link.uplink.none" });
  });

  it("dead: the cable ends at an empty point, and that point reports the balance", () => {
    expect(st("K6")).toMatchObject({ g: "err", key: "link.dead", vars: { pt: "J6" } });
    expect(keys(st("K6"))).not.toContain("link.none");
    expect(st("J6")).toMatchObject({ g: "warn", key: "link.bal", vars: { n: 1, pt: "J6" } });
  });

  it("bal: a splice box is allowed to split, so no finding", () => {
    expect(st("J7")).toBeUndefined();
    // Without one, the same fiber fan-out is a warning.
    expect(st("J9")).toMatchObject({ key: "link.bal" });
  });

  it("switch: uplink over fiber, PoE budget and occupied ports", () => {
    expect(st("S1")).toMatchObject({
      key: "link.uplink.ok",
      vars: { src: "H1", type: t("link.type.fiber", {}) },
    });
    expect(gear("S1")).toMatchObject({
      watts: 30.8,
      used: 3,
      // Nine, not eight: the USW Flex has eight PoE ports plus the 10G port it
      // can be fed through — the connector list counts them all.
      ports: 9,
      poe: 196,
      over: false,
      portsOver: false,
    });
    expect(gear("S1").devices.map((d: any) => d.label)).toEqual(["K1", "KL", "S7"]);
  });

  it("nosfp: fiber at a switch without an SFP port", () => {
    expect(st("S3")).toMatchObject({ g: "err", key: "link.nosfp" });
  });

  it("uplink.none: two switches that only hang off each other, and a passive shaft", () => {
    for (const l of ["S4", "S5", "S8"]) {
      expect(st(l), l).toMatchObject({ g: "warn", key: "link.uplink.none" });
    }
  });

  it("ports: a fiber uplink occupies none, a copper uplink does", () => {
    expect(gear("C1")).toMatchObject({ used: 1, ports: 1 });
    expect(gear("C1").devices.map((d: any) => d.label)).toEqual(["K9"]);
    // S7 feeds nothing, but its own copper uplink takes a port on itself.
    expect(gear("S7")).toMatchObject({ used: 1, ports: 8, watts: 0 });
    expect(gear("S7").devices).toEqual([]);
    expect(st("S7")).toMatchObject({
      key: "link.uplink.ok",
      vars: { type: t("link.type.cat", {}) },
    });
  });

  it("two devices in one box: budget and ports are summed, the converter needs 230 V", () => {
    expect(gear("J5")).toMatchObject({ watts: 15.4, used: 1, poe: 52, ports: 8 });
    expect(keys(st("J5"))).toEqual(["link.uplink.ok", "link.mains"]);
    expect(st("J5").more[0].vars).toMatchObject({ pt: "J5" });
    expect(st("J5").g).toBe("warn");
  });

  it("sfpcount: incoming fibers against the SFP slots", () => {
    expect(keys(st("S9"))).toEqual(["link.uplink.ok"]); // 2 fibers, 2 slots
    expect(st("S1").more).toEqual([{ key: "link.sfpcount", vars: { n: 2, ports: 1 } }]);
    // The fiber to the camera occupies no slot on the converter.
    expect(keys(st("C1"))).toEqual(["link.uplink.ok"]);
  });

  it("hub: router, ports, PoE budget and SFP balance", () => {
    expect(st("H1")).toMatchObject({ g: "warn", key: "link.hub.ok", vars: { n: 0 } });
    expect(st("H1").more).toEqual([{ key: "link.sfpcount", vars: { n: 5, ports: 1 } }]);
    // Four LAN ports: the UCG's fifth RJ45 is its 10G WAN uplink, and of the two
    // SFP+ cages one is WAN as well — neither is a place to hang a camera.
    expect(gear("H1")).toMatchObject({ watts: 15.4, used: 1, poe: 30, ports: 4 });
    expect(st("KH")).toMatchObject({ g: "ok", key: "link.ok", vars: { src: "H1" } });
  });

  it("a router without an SFP cage and without PoE: nosfp at the hub, nopoe at the camera", () => {
    S().infra.ucg = { on: false, qty: 1 };
    S().infra.fb7690 = { on: true, qty: 1 };
    invalidateLinks();
    expect(st("H1")).toMatchObject({ g: "err", key: "link.nosfp" });
    expect(st("KH")).toMatchObject({ key: "link.nopoe", vars: { src: "H1" } });
  });

  it("wan: the router's WAN sockets are no place for a camera", () => {
    S().infra.ucg = { on: false, qty: 1 };
    // Four LAN ports, a WAN Ethernet port and a WAN SFP cage: only the four count,
    // and the fibre at the hub still finds no cage.
    S().infra.fb5590 = { on: true, qty: 1 };
    invalidateLinks();
    expect(gear("H1")).toMatchObject({ ports: 4 });
    expect(st("H1")).toMatchObject({ g: "err", key: "link.nosfp" });
  });

  it("poeclass: a PoE+ camera on 802.3af ports is a warning", () => {
    // No switch in the catalogue is af-only, so for this one case the port list
    // says it is — the check reads the class off the ports, nothing else.
    const sw: any = JUNCTIONS.flex;
    const keep = sw.portList;
    try {
      sw.portList = keep.map((p: any) => (p.poe ? { ...p, poe: "af" } : p));
      byLabel("K1").model = "g6-180"; // PoE+ (802.3at)
      invalidateLinks();
      expect(st("K1")).toMatchObject({
        g: "warn",
        key: "link.poeclass",
        vars: { src: "S1", need: "PoE+ (802.3at)", have: "PoE (802.3af)" },
      });
      // The camera next to it needs plain PoE and stays quiet.
      expect(keys(st("KL"))).toEqual(["link.long"]);
    } finally {
      sw.portList = keep;
    }
  });

  it("ports: an injector has one jack for the uplink and one for the camera", () => {
    byLabel("S1").gear = [{ model: "u-poe-plus-plus", n: 1 }];
    invalidateLinks();
    // Two cameras on a single PoE jack — and the fibre finds no cage either.
    expect(gear("S1")).toMatchObject({ used: 2, ports: 2, portsOver: true });
    expect(st("S1")).toMatchObject({ g: "err", key: "link.nosfp" });
  });

  it("norouter: without a router the hub is only a cable point", () => {
    S().infra.ucg = { on: false, qty: 1 };
    invalidateLinks();
    // Fiber arrives at a hub that now has no SFP cage either — both are said.
    expect(keys(st("H1"))).toEqual(["link.nosfp", "link.norouter"]);
    expect(st("KH")).toMatchObject({ g: "err", key: "link.dead" });
  });

  it("taking the switch out of S1 leaves K1 connected but unsupplied", () => {
    byLabel("S1").gear = [];
    invalidateLinks();
    expect(st("K1")).toMatchObject({ g: "err", key: "link.deadup", vars: { pt: "S7" } });
  });

  it("taking the cable out of the conduit leaves nothing leading there", () => {
    S().conduits.find((c: any) => c.id === "cc").ducts = [{ pipe: "dn50", cables: [] }];
    invalidateLinks();
    expect(st("K1")).toMatchObject({ g: "err", key: "link.none" });
  });

  it("deleting the point leaves the cable in place and the source gone", () => {
    const s1 = byLabel("S1");
    S().items = S().items.filter((i: any) => i !== s1);
    invalidateLinks();
    const s: any = st("K1");
    expect(s).toMatchObject({ g: "err", key: "link.dead" });
    expect(s.vars.pt).toBeTruthy();
  });
});

describe("Passing fiber on and power at the point (powerPlan)", () => {
  beforeEach(() => load(powerPlan));

  it("a device with several SFP slots passes fiber on", () => {
    expect(keys(st("F1"))).toEqual(["link.uplink.ok"]);
    for (const l of ["F2", "F3"]) {
      expect(st(l), l).toMatchObject({
        g: "ok",
        key: "link.uplink.ok",
        vars: { src: "H1", type: t("link.type.fiber", {}) },
      });
    }
  });

  it("sfpcount: more fibers than slots, but the branches stay on the network", () => {
    expect(st("G1").more).toEqual([{ key: "link.sfpcount", vars: { n: 3, ports: 2 } }]);
    expect(st("G1").g).toBe("warn");
    expect(keys(st("G2"))).toEqual(["link.uplink.ok"]);
  });

  it("mains: 230 V only where there is no outlet and no PoE feed", () => {
    expect(keys(st("M1"))).toEqual(["link.uplink.ok", "link.mains"]);
    expect(st("M1").more[0].vars).toMatchObject({ pt: "M1" });
    // Power cable in the shaft, the same device indoors, and a PoE-fed switch.
    for (const l of ["M2", "M3", "P1"]) {
      expect(keys(st(l)), l).toEqual(["link.uplink.ok"]);
      expect(st(l).g, l).toBe("ok");
    }
    expect(keys(st("A1"))).toEqual(["link.uplink.ok", "link.mains"]);
  });

  it("a PoE-fed switch loads the feeder's budget and ports", () => {
    // ports: 9 — eight PoE ports plus the 10G port, as on S1 above.
    expect(gear("F2")).toMatchObject({ watts: 15, used: 5, poe: 196, ports: 9, over: false });
    expect(gear("F2").devices.map((d: any) => d.label)).toEqual(["M1", "M2", "M3", "P1", "A1"]);
  });
});

describe("old states (legacyPlan)", () => {
  beforeEach(() => load(legacyPlan));

  it("migrateJb turns the switch point into a location with a device inside", () => {
    const s = byLabel("S");
    expect(s.model).toBe("indoor");
    expect(s.gear).toEqual([{ model: "flex", n: 1 }]);
  });

  it("and the topology comes out the same as on a current plan", () => {
    expect(st("H1")).toMatchObject({ g: "ok", key: "link.hub.ok" });
    expect(st("K")).toMatchObject({ g: "ok", key: "link.ok", vars: { src: "S" } });
    expect(st("S")).toMatchObject({ key: "link.uplink.ok", vars: { src: "H1" } });
  });
});

describe("the cache", () => {
  it("memoises until it is invalidated", () => {
    load(linkPlan);
    const a = links();
    expect(links()).toBe(a);
    invalidateLinks();
    expect(links()).not.toBe(a);
  });
});
