// Derived connections: what hangs off what, and whether it is actually supplied.
import { t, tx } from "./i18n";
import { PX_PER_M } from "./geo";
import { CABLES, JUNCTIONS, modelOf } from "./catalogs";
import { condCables } from "./conduit";
import { state } from "./store";
import {
  hubCap,
  hubPoe,
  hubPower,
  hubRouter,
  hubSfp,
  hubSfpPorts,
  jbCap,
  jbDraw,
  jbExtend,
  jbGear,
  jbMains,
  jbPoe,
  jbPower,
  jbSfp,
  jbSplice,
  poeGives,
  poeNeed,
  poeWatts,
  sfpPorts,
} from "./gear";
import { POE_LABEL, POE_RANK } from "../catalog/index";
import type { CableType, Conduit, Item, LinkGear, LinkSource, LinkStatus, Links } from "./types";

/** One finding on its way into a LinkStatus — as its head or in `more`. */
type Prob = { key: string; vars: Record<string, string | number> };

/** An edge of the cable graph: the neighbouring point, its distance in m, the cable type. */
type Edge = { to: string; len: number; type: CableType };

/**
 * What reach() found. `seen` are the points the cable actually touches, even when
 * none of them is a source — the two cases are told apart by `src`, never by `len`.
 */
type Reach = (LinkSource & { seen: Item[] }) | { src: null; len: number; seen: Item[] };

/** What reachHub() found — `first` stays null only while the walk is still at the start. */
type Uplink = { src: Item; len: number; first: CableType | null; maxCat: number };

const isJb = (it: Item | null | undefined): boolean => !!it && it.kind === "jb";

// Copper comes from the hub or from any point holding a powered device;
// fiber only from a point whose devices bring an SFP port.
const isCopperSource = (it: Item): boolean =>
  it.kind === "hub" ? hubPower(it) : isJb(it) && jbPower(it);

// Fiber may only enter where it's also accepted: hub, passive point
// (it passes through even without a device) or a device with an SFP port. Copper may enter anywhere.
const takesFiber = (it: Item): boolean =>
  it.kind === "hub" ? hubSfp(it) : isJb(it) && (!jbPower(it) || jbSfp(it));

// Mains outlet on site: present indoors and in the 19″ rack, the hub sits in the house.
// Outdoors it only exists if a conduit with NYY-J arrives there.
export const mainsAt = (it: Item, touch: Map<string, Conduit[]>): boolean =>
  it.kind === "hub" ||
  it.model === "indoor" ||
  it.model === "rack19" ||
  (touch.get(it.id) || []).some((c) => condCables(c).some((x) => x.type === "power"));

// Adjacency: per conduit, the distance between two bound points, per cable type.
function linkEdges(): Map<string, Edge[]> {
  const adj = new Map<string, Edge[]>();
  const add = (a: string, b: string, len: number, type: CableType) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ to: b, len, type });
  };
  for (const c of state.conduits) {
    const types = [...new Set(condCables(c).map((x) => x.type))];
    if (!types.length) continue;
    // Distance along the route, not the whole conduit length: a trunk duct that
    // touches a shaft along the way is shorter up to that point.
    const marks: { id: string; off: number }[] = [];
    let run = 0;
    c.points.forEach((p, i) => {
      if (i) run += Math.hypot(p.x - c.points[i - 1].x, p.y - c.points[i - 1].y);
      if (p.at) marks.push({ id: p.at, off: run / PX_PER_M });
    });
    for (let a = 0; a < marks.length; a++)
      for (let b = a + 1; b < marks.length; b++) {
        if (marks[a].id === marks[b].id) continue;
        const len = Math.abs(marks[a].off - marks[b].off);
        for (const type of types) {
          add(marks[a].id, marks[b].id, len, type);
          add(marks[b].id, marks[a].id, len, type);
        }
      }
  }
  return adj;
}

function computeLinks(): Links {
  const byId = new Map(state.items.map((i): [string, Item] => [i.id, i]));
  const adj = linkEdges();
  const touch = new Map<string, Conduit[]>();
  for (const c of state.conduits) {
    for (const id of new Set(c.points.filter((p) => p.at).map((p) => p.at!))) {
      if (!touch.has(id)) touch.set(id, []);
      touch.get(id)!.push(c);
    }
  }
  const carries = (id: string, type: CableType) =>
    (touch.get(id) || []).some((c) => condCables(c).some((x) => x.type === type));
  // Shortest path to the first source. Along the way only passive junctions pass it
  // on — at a switch the run ends, and the next one begins there.
  // ponytail: Dijkstra without a heap, the graphs have a few dozen nodes.
  // `seen` are the points the cable actually reaches — even if none of them
  // is a source. The wrong message "No cable up to here" hinged on exactly this.
  function reach(start: string, type: CableType, isSource: (it: Item) => boolean): Reach {
    const best = new Map<string, number>([[start, 0]]);
    const q = [{ id: start, len: 0 }];
    const seen: Item[] = [];
    while (q.length) {
      q.sort((a, b) => a.len - b.len);
      const cur = q.shift()!;
      if (cur.id !== start) {
        const it = byId.get(cur.id);
        if (!it) continue;
        seen.push(it);
        if (isSource(it)) return { src: it, len: cur.len, seen };
        if (!isJb(it) || jbPower(it)) continue;
      }
      for (const e of adj.get(cur.id) || []) {
        if (e.type !== type) continue;
        const nl = cur.len + e.len;
        if (best.has(e.to) && best.get(e.to)! <= nl) continue;
        best.set(e.to, nl);
        q.push({ id: e.to, len: nl });
      }
    }
    return { src: null, len: 0, seen };
  }
  // Uplink: the path to the hub. Unlike reach(), it also runs through
  // active devices — two switches only hanging off each other still
  // arrive nowhere. The cable type is preserved along the way: it's only re-patched
  // at a device with power and an SFP port, a shaft can't do that. State is
  // therefore (node, incoming cable), not the node alone.
  // `first` is the cable arriving at the device itself, `maxCat` the longest
  // continuous copper run — the 90 m limit applies per run, not per path.
  function reachHub(start: string): Uplink | null {
    const best = new Map<string, number>();
    const q: {
      id: string;
      type: CableType | null;
      len: number;
      first: CableType | null;
      cu: number;
      mx: number;
    }[] = [{ id: start, type: null, len: 0, first: null, cu: 0, mx: 0 }];
    while (q.length) {
      q.sort((a, b) => a.len - b.len);
      const cur = q.shift()!;
      const it = byId.get(cur.id);
      if (!it) continue;
      if (it.kind === "hub")
        return { src: it, len: cur.len, first: cur.first, maxCat: Math.max(cur.mx, cur.cu) };
      if (cur.id !== start && !isJb(it)) continue; // no continuing through a camera or AP
      for (const e of adj.get(cur.id) || []) {
        if (e.type !== "cat" && e.type !== "fiber") continue;
        const to = byId.get(e.to);
        if (!to) continue;
        // Fiber needs something that accepts it at both ends …
        if (e.type === "fiber" && !(takesFiber(it) && takesFiber(to))) continue;
        // … and switching cable type needs a device that can re-patch it.
        if (cur.type && e.type !== cur.type && !(isJb(it) && jbPower(it) && jbSfp(it))) continue;
        const key = e.to + "|" + e.type,
          nl = cur.len + e.len;
        if (best.has(key) && best.get(key)! <= nl) continue;
        best.set(key, nl);
        q.push({
          id: e.to,
          type: e.type,
          len: nl,
          first: cur.first || e.type,
          cu: e.type === "cat" ? (cur.type === "cat" ? cur.cu : 0) + e.len : 0,
          mx: e.type === "cat" ? cur.mx : Math.max(cur.mx, cur.cu),
        });
      }
    }
    return null;
  }
  const status = new Map<string, LinkStatus>(),
    src = new Map<string, LinkSource>(),
    gear = new Map<string, LinkGear>();
  // Cable ends per point and cable type. A conduit that just passes through here contributes
  // two ends (in and out) and thus balances itself out; a conduit that
  // ends here contributes exactly one. That's what forms the balance at the junction.
  function cableEnds(id: string, type: CableType): number[] {
    const out: number[] = [];
    for (const c of touch.get(id) || []) {
      const n = condCables(c)
        .filter((x) => x.type === type)
        .reduce((a, x) => a + x.n, 0);
      if (!n) continue;
      const marks = c.points.filter((p) => p.at).map((p) => p.at);
      out.push(n);
      if (marks.indexOf(id) > 0 && marks.lastIndexOf(id) < marks.length - 1) out.push(n);
    }
    return out;
  }
  // Fiber cables that actually land in an SFP cage here. A cable to a
  // device that doesn't accept fiber at all (camera, AP) is its own finding — link.fiber
  // on the device — and must not be counted toward the cage here.
  function fiberEnds(id: string): number {
    let n = 0;
    for (const c of touch.get(id) || []) {
      const cnt = condCables(c)
        .filter((x) => x.type === "fiber")
        .reduce((a, x) => a + x.n, 0);
      if (!cnt) continue;
      const others = [...new Set(c.points.filter((p) => p.at && p.at !== id).map((p) => p.at!))]
        .map((x) => byId.get(x))
        .filter(Boolean) as Item[];
      if (others.length && !others.some(takesFiber)) continue;
      n += cnt;
    }
    return n;
  }
  // The largest bundle against the sum of the rest: if it doesn't balance, the
  // point would need to be split — and that's exactly what you don't do with fiber.
  function unbalanced(id: string, type: CableType): number {
    const ends = cableEnds(id, type);
    if (!ends.length) return 0;
    const mx = Math.max(...ends),
      rest = ends.reduce((a, b) => a + b, 0) - mx;
    return mx > rest ? mx - rest : 0;
  }
  // Junction without equipment: do the cables pass through, or end here? Power stays
  // out of scope — a buried cable ending at an outlet is not a finding.
  function balanceStatus(it: Item): LinkStatus | null {
    if (jbSplice(it)) return null;
    for (const type of ["fiber", "cat"] as CableType[]) {
      const n = unbalanced(it.id, type);
      if (n)
        return {
          g: "warn",
          key: "link.bal",
          vars: { n, type: tx(CABLES[type].name), pt: it.label },
        };
    }
    return null;
  }
  // Uplink per powered device — computed once, needed three times. If it arrives via
  // copper, it occupies a port on the device before it: there the switch counts as a
  // connected device, just without power draw (own power supply).
  const ups = new Map<string, Uplink>();
  for (const it of state.items) {
    if (!(isJb(it) && jbPower(it))) continue;
    const up = reachHub(it.id);
    if (up) ups.set(it.id, up);
    if (up && up.first === "cat") {
      const r = reach(it.id, "cat", isCopperSource);
      if (r.src) src.set(it.id, r);
    }
  }
  // A source only delivers if it's itself connected to the hub.
  const fed = (s: Item) => s.kind === "hub" || ups.has(s.id);
  // Copper limit for a specific run: 90 m plus every PoE extender along the way.
  const catMax = (seen: Item[]) =>
    CABLES.cat.max! + (seen || []).reduce((a, x) => a + (isJb(x) ? jbExtend(x) : 0), 0);
  const poeOf = (s: Item) => (s.kind === "hub" ? hubPoe(s) : jbPoe(s));
  for (const it of state.items) {
    if (it.kind !== "cam" && it.kind !== "ap") continue;
    const m = modelOf(it);
    if (!m || poeWatts(m) <= 0) continue;
    const r = reach(it.id, "cat", isCopperSource);
    // Two questions, not one: Am I cabled at all? And does whatever
    // I'm connected to actually deliver anything? "No cable up to here" used to be both at once —
    // and therefore wrong as soon as a cable ended at an empty point.
    if (!r.src) {
      if (carries(it.id, "fiber")) status.set(it.id, { g: "err", key: "link.fiber", vars: {} });
      else if (!carries(it.id, "cat")) status.set(it.id, { g: "err", key: "link.none", vars: {} });
      else {
        const pt = r.seen.find((x) => x.kind === "jb" || x.kind === "hub") || r.seen[0];
        const cd = (touch.get(it.id) || []).find((c) =>
          condCables(c).some((x) => x.type === "cat"),
        );
        status.set(it.id, {
          g: "err",
          key: "link.dead",
          // A conduit carries no label until adopt() names it — then the sentence
          // would read "cable ends at undefined". `!` keeps that visible instead of
          // papering over it with a fallback; see the report on this line.
          vars: { pt: pt ? pt.label : cd ? cd.label! : "–" },
        });
      }
      continue;
    }
    // Several things can apply at once — then all the sentences are listed, instead of
    // one hiding the other.
    const probs: Prob[] = [];
    // A point holding only a media converter delivers no PoE. The same
    // applies to a hub without a PoE switch and without a PoE output on the router.
    if (poeOf(r.src) === 0) probs.push({ key: "link.nopoe", vars: { src: r.src.label } });
    // Watts are not the whole story: a PoE+ camera on an 802.3af port negotiates
    // nothing. Only a source whose data sheet states its class can say so — an
    // unpublished class stays silent instead of guessing "af".
    const need = poeNeed(m),
      gives = poeGives(r.src);
    if (need && gives && POE_RANK[need] > POE_RANK[gives])
      probs.push({
        key: "link.poeclass",
        vars: { src: r.src.label, need: POE_LABEL[need], have: POE_LABEL[gives] },
      });
    // ponytail: the limit applies to the run device → source. A switch's uplink
    // (reachHub) doesn't collect intermediate points, so an extender has no effect there.
    if (r.len > catMax(r.seen)) probs.push({ key: "link.long", vars: { len: r.len.toFixed(0) } });
    src.set(it.id, r);
    // The source itself hangs off nothing: the device is connected, but dead.
    if (!fed(r.src)) {
      status.set(it.id, { g: "err", key: "link.deadup", vars: { pt: r.src.label }, more: probs });
      continue;
    }
    status.set(
      it.id,
      probs.length
        ? { g: "warn", key: probs[0].key, vars: probs[0].vars, more: probs.slice(1) }
        : { g: "ok", key: "link.ok", vars: { src: r.src.label, len: r.len.toFixed(0) } },
    );
  }
  for (const it of state.items) {
    const isHub = it.kind === "hub";
    const on = isHub || (isJb(it) && jbPower(it));
    // A passive point carries no equipment, but it does carry a cable balance.
    if (!on) {
      if (isJb(it)) {
        const b = balanceStatus(it);
        if (b) status.set(it.id, b);
      }
      continue;
    }
    const devices = state.items.filter((d) => src.get(d.id)?.src === it);
    // A point with its own power supply draws nothing, but a PoE-fed switch there
    // certainly does — it's on the same cable as a camera.
    const watts = devices.reduce(
      (a, d) => a + (d.kind === "jb" ? jbDraw(d) : poeWatts(modelOf(d))),
      0,
    );
    // The point's own uplink only occupies its own port if it arrives over copper
    // (fiber plugs into the SFP cage) — and only if the device before it
    // isn't already in the list, otherwise a cable would count twice.
    const feed = isHub ? null : src.get(it.id);
    const up = feed && !devices.includes(feed.src) ? 1 : 0;
    const used = devices.length + up;
    const poe = isHub ? hubPoe(it) : jbPoe(it),
      cap = isHub ? hubCap(it) : jbCap(it);
    gear.set(it.id, {
      devices,
      watts,
      used,
      poe,
      ports: cap.total,
      over: watts > poe,
      // Three ways to run out: too much hanging off it, nowhere for its own
      // uplink to land, or simply more cables than sockets.
      portsOver: devices.length > cap.down || up > cap.up || used > cap.total,
    });
    // Every incoming fiber wants an SFP cage. Without a single one,
    // link.nosfp applies — here it's only about the count.
    const more: Prob[] = [];
    const caps = isHub ? hubSfpPorts(it) : sfpPorts(it);
    const fibers = fiberEnds(it.id);
    if (caps > 0 && fibers > caps)
      more.push({ key: "link.sfpcount", vars: { n: fibers, ports: caps } });
    // A converter in an underground shaft needs 230 V — the plan didn't used to show that.
    // One finding per point: the first device that needs a mains outlet stands for it.
    const mn = jbMains(it);
    if (mn && !mainsAt(it, touch))
      more.push({ key: "link.mains", vars: { pt: it.label, gear: tx(JUNCTIONS[mn.model].name) } });
    let st: LinkStatus;
    if (isHub) {
      // The hub has no uplink — what's checked is what's there.
      if (!hubSfp(it) && carries(it.id, "fiber")) st = { g: "err", key: "link.nosfp", vars: {} };
      else if (!hubRouter()) st = { g: "warn", key: "link.norouter", vars: {} };
      else
        st = {
          g: "ok",
          key: "link.hub.ok",
          vars: { router: tx(hubRouter()!.name), n: jbGear(it).reduce((a, g) => a + g.n, 0) },
        };
      if (!hubRouter() && st.key !== "link.norouter")
        more.unshift({ key: "link.norouter", vars: {} });
    } else {
      const up = ups.get(it.id);
      st = up
        ? {
            g: "ok",
            key: "link.uplink.ok",
            vars: {
              src: up.src.label,
              len: up.len.toFixed(0),
              type: t(up.first === "fiber" ? "link.type.fiber" : "link.type.cat"),
            },
          }
        : { g: "warn", key: "link.uplink.none", vars: {} };
      if (up && up.maxCat > CABLES.cat.max!)
        st = { g: "warn", key: "link.long", vars: { len: up.maxCat.toFixed(0) } };
      if (!jbSfp(it) && carries(it.id, "fiber")) st = { g: "err", key: "link.nosfp", vars: {} };
    }
    // An additional finding can't stay silent: an "ok" with a warning is a warning.
    status.set(
      it.id,
      more.length
        ? { ...st, g: st.g === "err" ? "err" : "warn", more: (st.more || []).concat(more) }
        : st,
    );
  }
  return { status, src, gear, touch };
}

// Once per render pass: renderMap() discards the cached state, the first reader recomputes it.
export let LINKS: Links | null = null;

export function links(): Links {
  return LINKS || (LINKS = computeLinks());
}

// A finding can carry several sentences (too long AND no PoE). All displays
// therefore go through here, none read `key`/`vars` directly.
export const linkText = (s: LinkStatus | null | undefined): string =>
  s ? [t(s.key, s.vars)].concat((s.more || []).map((p) => t(p.key, p.vars))).join(" · ") : "";

// Written from other modules; ES module bindings are read-only for importers.
export const invalidateLinks = () => {
  LINKS = null;
};
