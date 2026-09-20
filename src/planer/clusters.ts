// Markers within 36 screen px drawn as one. Presentation, never state.
import { LOOK, sel, state } from "./store";
import type { Item, Point } from "./types";

// ---------- Clusters when zooming out ----------
// Pure display: none of this lives in `state`, none of it is saved
// or shared. Elements that sit close together on screen
// get merged into one marker — otherwise house, junction, camera, and AP
// one meter apart could no longer be told apart, let alone clicked.
// 36 px = two markers with 12 px radius each plus spacing. Below that they overlap,
// so they're merged before that point instead of only once nothing can be hit anymore.
const CLUSTER_PX = 36;

// ponytail: O(n²) over the elements — irrelevant with a few dozen markers.
// If the plan ever reaches four digits, add a grid here.
// `upp` is uPerPx() — map units per screen pixel. Passed in, not read from the
// DOM: that keeps this module free of it, and clustering is pure geometry.
export function buildClusters(upp: number): Item[][] {
  if (!LOOK.cluster) return []; // gear icon: clusters off, every marker on its own
  const d = CLUSTER_PX * upp;
  // Only the selected element stays visible on its own — even the house connection may go into a cluster,
  // otherwise it would sit half under the cluster circle.
  const free = state.items.filter((i) => !(sel && sel.kind === "item" && sel.id === i.id));
  const out: Item[][] = [],
    used = new Set<string>();
  for (const a of free) {
    if (used.has(a.id)) continue;
    const grp = [a];
    used.add(a.id);
    for (const b of free) {
      if (used.has(b.id) || Math.hypot(b.x - a.x, b.y - a.y) > d) continue;
      grp.push(b);
      used.add(b.id);
    }
    if (grp.length > 1) out.push(grp); // a cluster of one element isn't one
  }
  return out;
}

export let CLUSTERS: Item[][] = [],
  clusterSig = "",
  clusterTimer: ReturnType<typeof setTimeout> | null = null;

// Both helpers ask for only what they read, so a caller can hand them a bare
// id or a bare point.
export const clusterSigOf = (cs: { id: string }[][]): string =>
  cs.map((g) => g.map((i) => i.id).join(",")).join("|");

export const clusterOf = (id: string): Item[] | null =>
  CLUSTERS.find((g) => g.some((i) => i.id === id)) || null;

export const clusterCenter = (grp: { x: number; y: number }[]): { x: number; y: number } => ({
  x: grp.reduce((a, i) => a + i.x, 0) / grp.length,
  y: grp.reduce((a, i) => a + i.y, 0) / grp.length,
});

// If a conduit end is attached to an element that's currently in a cluster, the
// line must end at the cluster — otherwise it runs off into empty space next to it. Display only:
// `state` stays untouched, syncBonds() and the length calculation see the real location.
export function displayPos(p: Point): { x: number; y: number } {
  const g = p.at ? clusterOf(p.at) : null;
  return g ? clusterCenter(g) : p;
}

export const KIND_ORDER = ["cam", "ap", "jb", "hub"];

// Written from other modules; ES module bindings are read-only for importers.
export const setClusters = (v: Item[][]) => {
  CLUSTERS = v;
};
export const setClusterSig = (v: string) => {
  clusterSig = v;
};
export const setClusterTimer = (v: ReturnType<typeof setTimeout> | null) => {
  clusterTimer = v;
};
