// @ts-nocheck
// Conduits as data: ducts, cables, pipe rates, automatic names.
import { t, tx } from "./i18n";
import { CABLES, CABLE_ORDER, CONDUITS, PIPES } from "./catalogs";

// Cables have always belonged to a specific duct — `c.ducts` is therefore a
// list of ducts, each with its own cables. Anyone who just wants to know what's in the trench
// asks condCables(): the union across all ducts, once per type.
export const condDucts = (c) => (Array.isArray(c.ducts) ? c.ducts : []);

export const ductCables = (d) =>
  (d && Array.isArray(d.cables) ? d.cables : []).filter((x) => CABLES[x.type] && x.n > 0);

export function condCables(c) {
  const sum = new Map();
  for (const d of condDucts(c))
    for (const x of ductCables(d)) sum.set(x.type, (sum.get(x.type) || 0) + x.n);
  return CABLE_ORDER.filter((tp) => sum.has(tp)).map((tp) => ({ type: tp, n: sum.get(tp) }));
}

export const condKind = (c) => (condCables(c)[0] || {}).type || "pipe";

export const condColor = (c) => (CABLES[condKind(c)] || { color: "var(--line-2)" }).color;

// A cable run has no trench and no ducts — just a bundle of cables.
export const isCableRun = (c) => c.kind === "cable";

// The ducts of a trench, counted by type and in the order of PIPES.
// This is the only view of the duct list: cost, name and finding all go through it.
export function condPipes(c) {
  if (isCableRun(c)) return [];
  const sum = new Map();
  for (const d of condDucts(c)) {
    const k = PIPES[d.pipe] ? d.pipe : "dn50";
    sum.set(k, (sum.get(k) || 0) + 1);
  }
  return Object.keys(PIPES)
    .filter((k) => sum.has(k))
    .map((k) => ({ pipe: k, n: sum.get(k) }));
}

export const pipeRate = (c) => condPipes(c).reduce((a, p) => a + PIPES[p.pipe].m * p.n, 0);

// With exactly one duct it stays the plain name, otherwise the count goes in front.
const pipeText = (c) => {
  const one = condDucts(c).length < 2;
  return condPipes(c)
    .map((p) => (one ? "" : p.n + " × ") + tx(PIPES[p.pipe].name))
    .join(" + ");
};

const cableText = (c) =>
  condCables(c)
    .map((x) => x.n + " × " + tx(CABLES[x.type].name))
    .join(" + ");

export function condName(c) {
  const cab = cableText(c);
  if (isCableRun(c)) return t("cond.cableName", { cabs: cab || "–" });
  return [pipeText(c), cab].filter(Boolean).join(" + ");
}

// A conduit name from a catalog template (or from condName itself) is automatic:
// it follows along whenever duct or cable changes. Whoever types their own keeps it.
const TEMPLATE_NAMES = new Set(
  Object.values(CONDUITS)
    .flatMap((ct) => [ct.name.de, ct.name.en])
    .filter(Boolean),
);

export const isAutoLabel = (c) => {
  const l = (c.label || "").trim();
  return !l || TEMPLATE_NAMES.has(l) || l === condName(c);
};

export const cabList = (v) =>
  (Array.isArray(v) ? v : [])
    .filter((x) => x && CABLES[x.type])
    .map((x) => ({ type: x.type, n: Math.max(1, Math.min(12, +x.n || 1)) }));
