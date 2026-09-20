// Cost per conduit and the totals for the cost panel and the bill of materials.
import { APS, CABLES, CAMS, INFRA } from "./catalogs";
import { condCables, isCableRun, pipeRate } from "./conduit";
import { polyLength } from "./geom";
import { state } from "./store";
import { gearPrice, jbPrice } from "./gear";
import type { Conduit } from "./types";

export interface ConduitCost {
  len: number;
  pipe: number;
  cable: number;
  fixed: number;
  earth: number;
  total: number;
}

export function conduitCost(c: Conduit): ConduitCost {
  const len = polyLength(c.points);
  // Each duct costs individually by its type; the trench costs the earthwork.
  // A cable run has neither — there only the cable counts.
  const pipe = len * pipeRate(c);
  let cable = 0,
    fixed = 0;
  for (const e of condCables(c)) {
    const d = CABLES[e.type];
    cable += len * d.m * e.n;
    fixed += d.fixed * e.n;
  }
  const earth = isCableRun(c) ? 0 : len * (state.earthwork || 0);
  return { len, pipe, cable, fixed, earth, total: pipe + cable + fixed + earth };
}

export function costs() {
  const cams = state.items
    .filter((i) => i.kind === "cam")
    .map((i) => ({ ...i, price: CAMS[i.model as string].price }));
  const aps = state.items
    .filter((i) => i.kind === "ap")
    .map((i) => ({ ...i, price: APS[i.model as string].price }));
  // A point costs the housing plus everything inside it.
  const jbs = state.items.filter((i) => i.kind === "jb").map((i) => ({ ...i, price: jbPrice(i) }));
  // The hub carries no housing, but the same devices — they count under "junctions/equipment".
  const hubs = state.items
    .filter((i) => i.kind === "hub")
    .map((i) => ({ ...i, price: gearPrice(i) }));
  const conds = state.conduits.map((c) => ({ ...c, c: conduitCost(c) }));
  const infra = INFRA.filter((i) => !i.hidden)
    .map((i) => ({ ...i, ...state.infra[i.id] }))
    .filter((i) => i.on && i.qty > 0);
  const sumCams = cams.reduce((a, b) => a + b.price, 0);
  const sumAps = aps.reduce((a, b) => a + b.price, 0);
  const sumJbs = jbs.reduce((a, b) => a + b.price, 0) + hubs.reduce((a, b) => a + b.price, 0);
  const sumCond = conds.reduce((a, b) => a + b.c.total, 0);
  const sumInfra = infra.reduce((a, b) => a + b.price * b.qty, 0);
  const total = sumCams + sumAps + sumJbs + sumCond + sumInfra;
  const n4k = cams.filter((i) => /4K/.test(CAMS[i.model as string].res)).length;
  const n2k = cams.length - n4k;
  return {
    cams,
    aps,
    jbs,
    hubs,
    conds,
    infra,
    sumCams,
    sumAps,
    sumJbs,
    sumCond,
    sumInfra,
    total,
    n4k,
    n2k,
  };
}
