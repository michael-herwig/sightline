// Devices in a junction or at the hub: power, SFP, PoE, ports, price.
import { tx } from "./i18n";
import { INFRA, JUNCTIONS } from "./catalogs";
import { state } from "./store";
import type { Gear, InfraItem, Item, Junction } from "./types";

// Devices live in the junction — and since 09/2026 the same way in the hub (hub.gear).
export const jbGear = (it: Item | null | undefined): Gear[] =>
  it && Array.isArray(it.gear) ? it.gear.filter((g) => JUNCTIONS[g.model]) : [];

export const jbPower = (it: Item): boolean => jbGear(it).some((g) => JUNCTIONS[g.model].power);

export const jbSfp = (it: Item): boolean => jbGear(it).some((g) => JUNCTIONS[g.model].sfp);

export const jbPoe = (it: Item): number =>
  jbGear(it).reduce((a, g) => a + (JUNCTIONS[g.model].poe || 0) * g.n, 0);

// Outputs of a device. A PoE injector has two jacks, but one of them is the
// input: `poePorts` counts what actually goes onward. For a switch that's the
// port count itself, which is why the field only appears on the injector.
const gearPorts = (m: Junction): number => (m.poePorts != null ? m.poePorts : m.ports || 0);

// A media converter ahead of a switch adds no extra output — its
// one port feeds the switch internally. So switches count, otherwise converters do.
export const jbPorts = (it: Item): number => {
  const act = jbGear(it).filter((g) => JUNCTIONS[g.model].power);
  const sw = act.filter((g) => gearPorts(JUNCTIONS[g.model]) > 1);
  return (sw.length ? sw : act).reduce((a, g) => a + gearPorts(JUNCTIONS[g.model]) * g.n, 0);
};

// A PoE extender sits in the middle of the copper run and raises its limit by its
// range. It's not a source — power and data still come from upstream.
export const jbExtend = (it: Item): number =>
  jbGear(it).reduce((a, g) => a + (JUNCTIONS[g.model].extend || 0) * g.n, 0);

// Where a device gets its power from is stored as `powerIn` on the catalog entry:
// "mains" = its own power supply, "poe" = from the network cable, "none" = nothing at all.
// `power` still means "active device" — a PoE-powered switch is both.
export const powerIn = (m: Junction): NonNullable<Junction["powerIn"]> => m.powerIn || "none";

// The first device at the point that needs a mains socket. One finding per point.
export const jbMains = (it: Item): Gear | null =>
  jbGear(it).find((g) => powerIn(JUNCTIONS[g.model]) === "mains") || null;

// ponytail: what a PoE-powered device draws is rarely in the datasheet — 15 W
// (802.3af) is the safe assumption; `poeDraw` on the catalog entry overrides it.
export const jbDraw = (it: Item): number =>
  jbGear(it).reduce((a, g) => {
    const m = JUNCTIONS[g.model];
    return a + (powerIn(m) === "poe" ? (m.poeDraw != null ? m.poeDraw : 15) * g.n : 0);
  }, 0);

export const gearPrice = (it: Item): number =>
  jbGear(it).reduce((a, g) => a + JUNCTIONS[g.model].price * g.n, 0);

export const jbPrice = (it: Item): number =>
  ((it.model && JUNCTIONS[it.model]) || { price: 0 }).price + gearPrice(it);

// A splice box is allowed to split — then the cable balance at the point is no longer a finding.
export const jbSplice = (it: Item): boolean => jbGear(it).some((g) => g.model === "splice");

// SFP slots per point: the count sits on the device (`sfpPorts`, checked against the datasheet).
// Without a value it stays at one slot — an SFP module doesn't bring one along, it
// occupies one, which is why it explicitly carries 0.
export const sfpPorts = (it: Item): number =>
  jbGear(it).reduce((a, g) => {
    const m = JUNCTIONS[g.model];
    return a + (m.sfpPorts != null ? m.sfpPorts : m.sfp ? 1 : 0) * g.n;
  }, 0);

export const gearNames = (it: Item): string =>
  jbGear(it)
    .map((g) => (g.n > 1 ? g.n + " × " : "") + tx(JUNCTIONS[g.model].name))
    .join(" + ");

// ---------- Hub: router from INFRA, devices like in a junction ----------
// The service entrance used to be an all-rounder: copper and fibre source at once, PoE
// unchecked. In reality there's a router and usually a switch or converter.
// One router per plan — the first planned entry with role "router" counts.
export const ROUTERS: InfraItem[] = INFRA.filter((i) => i.role === "router");

export const hubRouter = (): InfraItem | null =>
  ROUTERS.find((r) => {
    const st = state.infra[r.id];
    return st && st.on && (st.qty || 0) > 0;
  }) || null;

export const hubPower = (it: Item): boolean => !!hubRouter() || jbPower(it);

export const hubSfp = (it: Item): boolean => {
  const r = hubRouter();
  return !!(r && r.sfp) || jbSfp(it);
};

export const hubPoe = (it: Item): number => (hubRouter()?.poe || 0) + jbPoe(it);

export const hubPorts = (it: Item): number => (hubRouter()?.ports || 0) + jbPorts(it);

// The UCG has two SFP+, but only one can be switched to LAN — the other stays WAN.
export const hubSfpPorts = (it: Item): number => (hubRouter()?.sfp ? 1 : 0) + sfpPorts(it);

// ---------- Connections: which device hangs off what ----------
// None of this is stored. The topology already lives in the plan: a conduit point
// with `at` touches an element, and the cables in the conduit say what arrives there.
// What a device draws from the network cable. 0 = own power supply or WLAN,
// such devices need no connection at all.
export function poeWatts(m: { poe?: unknown } | null | undefined): number {
  const p = String(tx(m && m.poe) || "");
  if (/802\.3bt/.test(p)) return 60;
  if (/802\.3at/.test(p)) return 30;
  if (/802\.3af/.test(p)) return 15.4;
  return 0;
}

// Devices from all points, counted by model — for the bill of materials, text, and sheet.
export function jbGearGroups(jbs: Item[]): Record<string, number> {
  const g: Record<string, number> = {};
  jbs.forEach((i) =>
    jbGear(i).forEach((x) => {
      g[x.model] = (g[x.model] || 0) + x.n;
    }),
  );
  return g;
}
