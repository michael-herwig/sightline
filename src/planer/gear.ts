// Devices in a junction or at the hub: power, SFP, PoE, ports, price.
//
// Ports are never counted by hand here. Every device carries the connector list
// from its data sheet (`portList`), and `rj45Cap`/`sfpCages`/`poeOut` in
// src/catalog/index.ts turn it into numbers — see the "Ports" section of
// docs/DATA-MODEL.md.
import { tx } from "./i18n";
import { INFRA, JUNCTIONS } from "./catalogs";
import { POE_RANK, poeOut, rj45Cap, sfpCages } from "../catalog/index";
import type { PoeClass, PortCap } from "../catalog/index";
import { state } from "./store";
import type { Gear, InfraItem, Item, Junction, Model, Port } from "./types";

export type { PoeClass, PortCap };

/** The connectors of a catalogue entry. Nothing published = nothing to plug in. */
const portsOf = (m: Model | null | undefined): Port[] =>
  m && Array.isArray(m.portList) ? m.portList : [];

const NO_PORTS: PortCap = { down: 0, up: 0, total: 0 };

const addCap = (a: PortCap, c: PortCap, n: number): PortCap => ({
  down: a.down + c.down * n,
  up: a.up + c.up * n,
  total: a.total + c.total * n,
});

// Devices live in the junction — and since 09/2026 the same way in the hub (hub.gear).
export const jbGear = (it: Item | null | undefined): Gear[] =>
  it && Array.isArray(it.gear) ? it.gear.filter((g) => JUNCTIONS[g.model]) : [];

export const jbPower = (it: Item): boolean => jbGear(it).some((g) => JUNCTIONS[g.model].power);

export const jbPoe = (it: Item): number =>
  jbGear(it).reduce((a, g) => a + (JUNCTIONS[g.model].poe || 0) * g.n, 0);

// RJ45 at a point: the devices bring it, the housing does not, and a passive part
// (surge protector) hands nothing on. `down` is what a camera can hang off, `up`
// where the point's own uplink lands — an injector's two jacks are one of each.
//
// A media converter ahead of a switch adds no extra output: its one port feeds
// the switch internally. So whatever distributes (more than one downstream port)
// counts, and only if nothing does, the single-port devices do.
export function jbCap(it: Item): PortCap {
  const act = jbGear(it).filter((g) => JUNCTIONS[g.model].power);
  const cap = (g: Gear) => rj45Cap(portsOf(JUNCTIONS[g.model]));
  const dist = act.filter((g) => cap(g).down > 1);
  return (dist.length ? dist : act).reduce((a, g) => addCap(a, cap(g), g.n), NO_PORTS);
}

export const jbPorts = (it: Item): number => jbCap(it).total;

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

// SFP cages per point, straight off the connector lists. A module doesn't bring a
// cage along, it occupies one — hence `n: 0` in its port list, and hence a switch
// without a cage stays without one no matter how many modules lie next to it.
export const sfpPorts = (it: Item): number =>
  jbGear(it).reduce((a, g) => a + sfpCages(portsOf(JUNCTIONS[g.model])) * g.n, 0);

/** Fibre only lands where a cage takes it. */
export const jbSfp = (it: Item): boolean => sfpPorts(it) > 0;

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

export const hubPoe = (it: Item): number => (hubRouter()?.poe || 0) + jbPoe(it);

// The router's own ports plus whatever sits in the hub. Its WAN ports are typed
// `wan` in the product file and drop out in rj45Cap() — the internet arrives
// there, no camera does.
export const hubCap = (it: Item): PortCap => addCap(jbCap(it), rj45Cap(portsOf(hubRouter())), 1);

export const hubPorts = (it: Item): number => hubCap(it).total;

// The UCG has two SFP+, but one of them is the WAN uplink — so only the LAN-side
// cage counts, and on a FRITZ!Box the cage is the WAN port and none does.
export const hubSfpPorts = (it: Item): number => sfpCages(portsOf(hubRouter())) + sfpPorts(it);

export const hubSfp = (it: Item): boolean => hubSfpPorts(it) > 0;

// ---------- Connections: which device hangs off what ----------
// None of this is stored. The topology already lives in the plan: a conduit point
// with `at` touches an element, and the cables in the conduit say what arrives there.
// The class as it is printed on a camera or access point, for the entries whose
// data sheet gave no `poeIn`.
const printedClass = (m: { poe?: unknown } | null | undefined): PoeClass | null => {
  const p = String(tx(m && m.poe) || "");
  return /802\.3bt/.test(p) ? "bt" : /802\.3at/.test(p) ? "at" : /802\.3af/.test(p) ? "af" : null;
};

const WATTS: Record<PoeClass, number> = { af: 15.4, at: 30, bt: 60 };

// What a device draws from the network cable. 0 = own power supply or WLAN,
// such devices need no connection at all.
export function poeWatts(m: { poe?: unknown } | null | undefined): number {
  const c = printedClass(m);
  return c ? WATTS[c] : 0;
}

/** What a camera or access point needs. `af/at` runs on plain PoE, so: af. */
export const poeNeed = (m: Model | null | undefined): PoeClass | null =>
  m && m.poeIn ? (m.poeIn === "af/at" ? "af" : m.poeIn) : printedClass(m);

/** The strongest class a point hands out; null when no port publishes one. */
export const poeGives = (it: Item): PoeClass | null => {
  const each = jbGear(it).map((g) => poeOut(portsOf(JUNCTIONS[g.model])));
  if (it.kind === "hub") each.push(poeOut(portsOf(hubRouter())));
  return each.reduce<PoeClass | null>(
    (a, c) => (c && (!a || POE_RANK[c] > POE_RANK[a]) ? c : a),
    null,
  );
};

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
