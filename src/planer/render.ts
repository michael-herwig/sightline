// Drawing the map, and the viewport commands that redraw it.
import { GEO, HOME, PX_PER_M } from "./geo";
import { APS, CABLES, CABLE_ORDER, CAMS } from "./catalogs";
import { condColor, condDucts, condName, ductCables, isCableRun } from "./conduit";
import { CSEC_R, dOf, offsetPath, pointAtLen, polyLength, sectionOffsets } from "./geom";
import { LOOK, draft, mode, sel, setDrag, setView, state, view } from "./store";
import { jbPower } from "./gear";
import { invalidateLinks, links } from "./links";
import { $, el, gCond, gCover, gDraft, gHand, gLab, gMark, gSec, pick, svg } from "./dom";
import { boundCount, syncBonds } from "./bonds";
import { changed } from "./history";
import { select } from "./modes";
import {
  SCALE,
  calcScale,
  canHistory,
  contentBox,
  markerTransform,
  scaleAt,
  setScale,
  startDrag,
  syncAspect,
  toSvg,
  uPerPx,
  viewState,
} from "./view";
import { setHoverKey } from "./hover";
import {
  CLUSTERS,
  KIND_ORDER,
  buildClusters,
  clusterCenter,
  clusterOf,
  clusterSig,
  clusterSigOf,
  clusterTimer,
  displayPos,
  setClusterSig,
  setClusterTimer,
  setClusters,
} from "./clusters";
import { applyBasemap, basemapLater } from "./tiles";
import type { Conduit, Duct, Item, Point, View } from "./types";

// Zooming doesn't redraw: only the transforms of existing nodes get updated.
// Tiles, cones, and ranges stay untouched in the process.
export function refreshScale() {
  const s = +calcScale().toFixed(4);
  if (s === SCALE) return;
  setScale(s);
  for (const g of [gMark, gSec, gLab, gHand, gDraft]) {
    g.querySelectorAll("[data-sx]").forEach((n: SVGElement) => {
      n.setAttribute(
        "transform",
        markerTransform(
          { x: +n.dataset.sx!, y: +n.dataset.sy! },
          n.dataset.srot == null ? null : +n.dataset.srot,
        ),
      );
    });
  }
  refreshOffsets();
}

export function applyView() {
  syncAspect();
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  refreshScale();
  clusterLater();
  // Scale bar: the largest round length that still fits in ~140 px — 5 m to 5 km.
  const pxPerM = PX_PER_M * (svg.clientWidth / view.w);
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  let m = steps[0];
  for (const st of steps) if (st * pxPerM <= 140) m = st;
  $("scalebar-i").style.width = Math.max(4, m * pxPerM) + "px";
  $("scalebar-t").textContent = m >= 1000 ? m / 1000 + " km" : m + " m";
  if (!state.view) state.view = {} as View; // the four lines below fill it
  state.view.x = view.x;
  state.view.y = view.y;
  state.view.w = view.w;
  state.view.h = view.h;
  basemapLater();
}

let popping = false;

export function jumpView(apply: () => void) {
  if (popping || !canHistory()) {
    apply();
    return;
  }
  try {
    history.replaceState({ ...history.state, slView: viewState() }, "");
  } catch {}
  apply();
  try {
    history.pushState({ slView: viewState() }, "");
  } catch {}
}

// centerOn() adjusts afterward when dockview sets the panel size only later. Then the
// entry has to move along — otherwise "Forward" lands on the half-corrected view.
export function syncJump() {
  if (popping || !canHistory()) return;
  try {
    if (history.state && history.state.slView) history.replaceState({ slView: viewState() }, "");
  } catch {}
}

// Fit a rectangle, using the element's aspect ratio.
function fitTo(r: View) {
  const w = svg.clientWidth || 1,
    h = svg.clientHeight || 1;
  const vw = Math.max(r.w, r.h * (w / h));
  setView({
    x: r.x + r.w / 2 - vw / 2,
    y: r.y + r.h / 2 - (vw * h) / w / 2,
    w: vw,
    h: (vw * h) / w,
  });
  applyView();
}

export function fit() {
  fitTo(contentBox() || HOME);
}

// Saved viewport, otherwise the property.
export function restoreView() {
  const v = state.view;
  const ok =
    v &&
    (["x", "y", "w", "h"] as const).every((k) => typeof v[k] === "number" && isFinite(v[k])) &&
    v.w > 0 &&
    v.h > 0;
  setView(ok ? { ...v } : { ...HOME });
  applyView();
  // applyBasemap(pad) takes an optional argument; tiles.ts is still untyped,
  // so the parameter reads as required until it is annotated there.
  applyBasemap();
}

export function zoomAt(f: number, cx: number, cy: number) {
  // Limit: 1 m may be at most 140 screen px long, then it stops.
  const minW = ((svg.clientWidth || 800) / 140) * PX_PER_M;
  const maxW = ((svg.clientWidth || 800) / 140) * 5000 * PX_PER_M; // up to 5 km on the scale bar
  const nw = Math.min(maxW, Math.max(minW, view.w / f));
  const nh = nw * (view.h / view.w);
  const k = nw / view.w;
  view.x = cx - (cx - view.x) * k;
  view.y = cy - (cy - view.y) * k;
  view.w = nw;
  view.h = nh;
  applyView();
}

// Drawing is split into three building blocks so that dragging doesn't
// need to rebuild the whole map — that's exactly what used to stutter before.
function drawCover(it: Item) {
  if (it.kind === "cam") {
    const m = CAMS[it.model!],
      r = m.ir * PX_PER_M;
    if (m.fov >= 360)
      return el("circle", { class: "cone", "data-id": it.id, cx: it.x, cy: it.y, r }, gCover);
    const a1 = ((it.rot! - m.fov / 2) * Math.PI) / 180,
      a2 = ((it.rot! + m.fov / 2) * Math.PI) / 180;
    const large = m.fov > 180 ? 1 : 0;
    const d = `M ${it.x} ${it.y} L ${it.x + r * Math.cos(a1)} ${it.y + r * Math.sin(a1)} A ${r} ${r} 0 ${large} 1 ${it.x + r * Math.cos(a2)} ${it.y + r * Math.sin(a2)} Z`;
    return el("path", { class: "cone", "data-id": it.id, d }, gCover);
  }
  if (it.kind === "ap") {
    // Two rings: inner is the reliable zone (walls, furniture, rain — roughly half),
    // outer dashed is the open-field range per manufacturer spec. Outdoors the
    // reliable zone is two thirds, because fewer walls are in the way.
    const m = APS[it.model!],
      r = m.radius * PX_PER_M;
    const g = el("g", { class: "apcover", "data-id": it.id }, gCover),
      show = it.rings || "both";
    if (show === "both" || show === "far")
      el("circle", { class: "apcircle far", cx: it.x, cy: it.y, r }, g);
    // Placement decides the reliable zone: indoors walls cut it in half, outdoors about two thirds remains.
    const outdoors = (it.place || (m.out ? "out" : "in")) === "out";
    if (show === "both" || show === "near")
      el(
        "circle",
        { class: "apcircle near", cx: it.x, cy: it.y, r: r * (outdoors ? 0.66 : 0.5) },
        g,
      );
    return g;
  }
  return null;
}

// Widths in screen points (non-scaling-stroke); --sw scales them up in the export.
const strokePx = (px: number) => `stroke-width: calc(${px}px * var(--sw) * var(--look-line))`;

// One entry per cable in a duct, fixed order fiber → copper → power.
const strandList = (duct: Duct) =>
  CABLE_ORDER.flatMap((tp) => {
    const e = ductCables(duct).find((x) => x.type === tp);
    return e ? Array.from({ length: Math.min(12, e.n) }, () => tp) : [];
  });

const DUCT_GAP = 3; // narrowest duct slot on screen, in px

const STRAND_GAP = 2; // spacing between two strands in the same duct, in px

const STRAND_MAX = 8; // beyond this many strands, only the cross-section shows them

// How wide the trench becomes and where duct lines and strands sit — all in
// screen points. Each duct gets a slot wide enough for its cables;
// the slots sit side by side and the whole set is centered on the path.
function condLayout(c: Conduit) {
  let left = STRAND_MAX;
  const per = condDucts(c).map((d) => {
    const l = strandList(d).slice(0, left);
    left -= l.length;
    return l;
  });
  const slots = per.map((l) => Math.max(DUCT_GAP, (l.length - 1) * STRAND_GAP + DUCT_GAP));
  const width = slots.reduce((a, w) => a + w, 0);
  let run = -width / 2;
  const at = slots.map((w) => {
    const mid = run + w / 2;
    run += w;
    return mid;
  });
  return { per, at, width };
}

function drawConduit(c: Conduit) {
  // What's drawn is the display path: ends at cluster members move to the
  // cluster center. Labels use the same points; the cost calculation
  // (conduitCost) doesn't — it only knows the real coordinates.
  const pts = c.points.map(displayPos);
  const d = pts.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y).join(" ");
  const g = el(
    "g",
    {
      class: "conduit" + (sel && sel.kind === "conduit" && sel.id === c.id ? " selected" : ""),
      "data-id": c.id,
    },
    gCond,
  );
  // Three layers on the same path instead of a stroke that just gets thicker:
  // trench (only with a duct), one thin parallel per duct, and inside it one
  // colored strand next to that parallel.
  const piped = !isCableRun(c),
    lo = condLayout(c);
  // The slots spread apart with the stroke width, otherwise the strands would overlap.
  const trenchW = 6 + lo.width,
    k = uPerPx() * LOOK.line;
  // The white outline keeps the conduit visible on dark aerial imagery. Without a duct it stays
  // narrow — otherwise a bare buried cable would look like a trench.
  el("path", { class: "halo", d, style: strokePx(piped ? trenchW + 4 : 6) }, g);
  if (piped) el("path", { class: "trench", d, style: strokePx(trenchW) }, g);
  // The offset is stored as screen points on the node (`data-off`); refreshOffsets()
  // recomputes it into map units on zoom, without redrawing the map.
  const lay = (cls: string, off: number, attrs: Record<string, unknown>) =>
    el(
      "path",
      Object.assign(
        { class: cls, "data-off": off.toFixed(2), d: dOf(offsetPath(pts, off * k)) },
        attrs,
      ),
      g,
    );
  lo.at.forEach((mid, di) => {
    const strands = lo.per[di];
    // An empty duct with no cable stays dashed — that's always how spare capacity looked.
    if (piped)
      lay("duct", mid, {
        "data-duct": di,
        style: strokePx(1.5),
        "stroke-dasharray": strands.length ? "" : "8 6",
      });
    strands.forEach((tp, i) =>
      lay("strand", mid + (i - (strands.length - 1) / 2) * STRAND_GAP, {
        "data-duct": di,
        stroke: CABLES[tp].color,
        style: strokePx(2),
        "stroke-dasharray": tp === "cat" ? "12 5" : "",
      }),
    );
  });
  // The core is now just the hit area — it's no longer visible.
  const core = el("path", { class: "core", d, style: strokePx(Math.max(10, trenchW)) }, g);
  core.addEventListener("pointerdown", (e: PointerEvent) => {
    if (mode !== "select") return;
    e.stopPropagation();
    // Double-clicking the duct places a point there. The browser doesn't provide
    // a dblclick event for this: the map gets redrawn between the two clicks,
    // so the second click hits a different node. So count it manually.
    if (isDoubleTap(e)) {
      e.preventDefault();
      setDrag(null);
      insertVertex(c, toSvg(e));
      return;
    }
    select({ kind: "conduit", id: c.id });
  });
  // Label in its own group above the markers: along the duct,
  // shifted a bit to the side of the line, never upside down. It used to sit in the conduit
  // itself, and thus under the camera, the cone, and the neighboring duct.
  // Each label sits in its own, co-scaled group at the middle of the
  // segment: translate + scale + rotate. The 7 px offset then lies in the
  // rotated system, so always above the line — the same as the old normal-vector approach.
  const lg = el("g", { class: "clabels", "data-id": c.id }, gLab);
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1],
      p1 = pts[i],
      dx = p1.x - p0.x,
      dy = p1.y - p0.y,
      len = Math.hypot(dx, dy),
      L = len / PX_PER_M;
    if (L < 8) continue;
    let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (ang > 90 || ang < -90) ang += 180; // text reads left to right
    const box = scaleAt(el("g", {}, lg), (p0.x + p1.x) / 2, (p0.y + p1.y) / 2, +ang.toFixed(1));
    el("text", { class: "len", x: 0, y: -7, "text-anchor": "middle" }, box).textContent =
      L.toFixed(0) + " m";
  }
  drawSections(c, pts);
  return g;
}

function drawSections(c: Conduit, pts: Point[]) {
  gSec.querySelectorAll(`g.csection[data-id="${c.id}"]`).forEach((n: Element) => n.remove());
  const k = uPerPx();
  sectionOffsets(c, pts, k).forEach((o) => drawCrossSection(c, pointAtLen(pts, o)));
}

function drawCrossSection(c: Conduit, at: { x: number; y: number; a: number }) {
  const piped = !isCableRun(c),
    ducts = condDucts(c);
  // Rotated like the length label (never upside down) and then shifted to the other side
  // of the line: right on the route, the badge would sit on top of the meter label.
  let ang = at.a;
  if (ang > 90 || ang < -90) ang += 180;
  const box = scaleAt(
    el("g", { class: "csection", "data-id": c.id }, gSec),
    at.x,
    at.y,
    +ang.toFixed(1),
  );
  const g = el("g", { transform: "translate(0 17)" }, box);
  // Circles side by side **along** the route, touching — no ring inside a ring.
  const r = ducts.length <= 2 ? CSEC_R : ducts.length <= 4 ? 7 : 5.5;
  ducts.forEach((duct, di) => {
    const cx = (di - (ducts.length - 1) / 2) * 2 * r;
    if (piped) el("circle", { class: "duct", cx: cx.toFixed(2), cy: 0, r }, g);
    const list = strandList(duct);
    // More than eight dots stop being a picture and become confetti — show the number instead.
    const total = ductCables(duct).reduce((a, x) => a + x.n, 0);
    if (total > 8) {
      el("text", { x: cx.toFixed(2), y: 0 }, g).textContent = String(total);
      return;
    }
    list.forEach((tp, j) => {
      const rr = list.length === 1 ? 0 : r * 0.45,
        a = -Math.PI / 2 + (2 * Math.PI * j) / list.length;
      el(
        "circle",
        {
          class: "cable",
          cx: (cx + rr * Math.cos(a)).toFixed(2),
          cy: (rr * Math.sin(a)).toFixed(2),
          r: 1.5,
          fill: CABLES[tp].color,
        },
        g,
      );
    });
  });
  const nm = condName(c),
    lbl = (c.label || "").trim();
  el("title", {}, g).textContent = (lbl && lbl !== nm ? lbl + " · " : "") + nm;
  g.addEventListener("pointerdown", (e: PointerEvent) => {
    if (mode !== "select") return;
    e.stopPropagation();
    select({ kind: "conduit", id: c.id });
  });
  return box;
}

// The parallels and the cross-sections are geometry, not a stroke: their spacing lives
// in map units. On zoom only their `d` is updated; the cross-sections
// are only re-placed when a different number of them fits the route.
// ponytail: linear search per conduit — irrelevant with a few dozen conduits.
export function refreshOffsets() {
  const k = uPerPx();
  gCond.querySelectorAll("g.conduit[data-id]").forEach((g: SVGElement) => {
    const c = state.conduits.find((x) => x.id === g.dataset.id);
    if (!c) return;
    const pts = c.points.map(displayPos);
    g.querySelectorAll("path[data-off]").forEach((p) =>
      p.setAttribute("d", dOf(offsetPath(pts, +(p as SVGElement).dataset.off! * k * LOOK.line))),
    );
    if (
      sectionOffsets(c, pts, k).length !==
      gSec.querySelectorAll(`g.csection[data-id="${c.id}"]`).length
    )
      drawSections(c, pts);
  });
}

// The point handles sit in their own group at the very top. They used to be
// under the markers: a point under a camera was no longer grabbable.
function drawHandles() {
  gHand.innerHTML = "";
  if (!sel || sel.kind !== "conduit") return;
  const c = state.conduits.find((x) => x.id === sel!.id); // guarded two lines up; `sel` is an imported binding, so the narrowing does not reach into the callback
  if (!c) return;
  const col = condColor(c);
  c.points.forEach((p, idx) => {
    // A handle on an element that's currently in a cluster would hang free
    // in open space — its marker isn't drawn after all.
    if (p.at && clusterOf(p.at)) return;
    const box = scaleAt(el("g", {}, gHand), p.x, p.y);
    // id and index ride along on the node: the context menu resolves its target
    // from the DOM, so it must not have to guess which point was hit.
    const v = el(
      "circle",
      {
        class: "vtx" + (p.at ? " bound" : ""),
        r: 5,
        stroke: p.at ? "var(--jb)" : col,
        "data-cid": c.id,
        "data-idx": idx,
      },
      box,
    );
    v.addEventListener("pointerdown", (e: PointerEvent) => {
      e.stopPropagation();
      // Double-clicking a point removes it; right-clicking opens the menu (menu.ts).
      if (isDoubleTap(e)) {
        e.preventDefault();
        setDrag(null);
        dropVertex(c, idx);
        return;
      }
      startDrag(e, { type: "vtx", c, idx });
    });
  });
}

// Two clicks in quick succession at nearly the same spot count as a double-click,
// regardless of whether a redraw happened in between.
let lastTap = { t: 0, x: 0, y: 0 };

function isDoubleTap(e: MouseEvent) {
  const now = Date.now();
  const hit =
    now - lastTap.t < 450 &&
    Math.abs(e.clientX - lastTap.x) < 8 &&
    Math.abs(e.clientY - lastTap.y) < 8;
  lastTap = { t: hit ? 0 : now, x: e.clientX, y: e.clientY };
  return hit;
}

// Remove point: below two points it's no longer a conduit, so it stays put.
export function dropVertex(c: Conduit, idx: number) {
  if (c.points.length <= 2) return;
  c.points.splice(idx, 1);
  changed();
}

// Add point: project onto the nearest segment and insert it there.
export function insertVertex(c: Conduit, p: { x: number; y: number }) {
  let best = 1,
    bd = Infinity,
    bp: { x: number; y: number } | null = null;
  for (let i = 1; i < c.points.length; i++) {
    const a = c.points[i - 1],
      b = c.points[i];
    const dx = b.x - a.x,
      dy = b.y - a.y,
      l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    const q = { x: a.x + u * dx, y: a.y + u * dy },
      d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bd) {
      bd = d;
      best = i;
      bp = q;
    }
  }
  if (!bp) return;
  c.points.splice(best, 0, { x: +bp.x.toFixed(1), y: +bp.y.toFixed(1) });
  select({ kind: "conduit", id: c.id });
  changed();
}

function drawMarker(it: Item) {
  // Filled diamond = a powered device sits here. Otherwise it's just a place
  // where cables come together.
  const g = scaleAt(
    el(
      "g",
      {
        class:
          "marker " +
          it.kind +
          (jbPower(it) ? " active" : "") +
          (sel && sel.kind === "item" && sel.id === it.id ? " selected" : ""),
        "data-id": it.id,
      },
      gMark,
    ),
    it.x,
    it.y,
  );
  const r = it.kind === "hub" ? 15 : 12;
  if (it.kind === "cam") {
    const a = (it.rot! * Math.PI) / 180;
    el(
      "line",
      { class: "dir", x1: 0, y1: 0, x2: (r + 8) * Math.cos(a), y2: (r + 8) * Math.sin(a) },
      g,
    );
  }
  if (it.kind === "jb") {
    // Diamond instead of circle: junctions shouldn't read as a device on the map.
    el(
      "rect",
      { class: "body", x: -r, y: -r, width: r * 2, height: r * 2, rx: 3, transform: "rotate(45)" },
      g,
    );
    if (boundCount(it.id)) el("circle", { class: "bond", r: r + 6 }, g);
  } else {
    el("circle", { class: "body", r }, g);
  }
  // Finding from links(): red ring = no or wrong connection, yellow = warning.
  // Belongs to the map, so it also shows up in print and image export.
  const st = links().status.get(it.id);
  if (st && st.g !== "ok") {
    const rr = r + (it.kind === "jb" ? 10 : 6);
    el("circle", { class: "alerthalo", r: rr }, g);
    el("circle", { class: "alert " + st.g, r: rr }, g);
  }
  el("text", { x: 0, y: 0 }, g).textContent = it.label;
  if (
    it.kind === "cam" &&
    sel &&
    sel.kind === "item" &&
    sel.id === it.id &&
    CAMS[it.model!].fov < 360
  ) {
    const rr = r + 14,
      a = (it.rot! * Math.PI) / 180,
      hx = rr * Math.cos(a),
      hy = rr * Math.sin(a);
    el("circle", { class: "rotring", r: rr }, g);
    const hit = el("circle", { class: "rothit", cx: hx, cy: hy, r: 11 }, g);
    el("circle", { class: "rothandle", cx: hx, cy: hy, r: 5.5 }, g);
    hit.addEventListener("pointerdown", (e: PointerEvent) => {
      if (mode !== "select") return;
      e.stopPropagation();
      startDrag(e, { type: "rot", it });
    });
  }
  g.addEventListener("pointerdown", (e: PointerEvent) => {
    if (mode !== "select") return;
    e.stopPropagation();
    select({ kind: "item", id: it.id });
    startDrag(e, { type: "item", it });
  });
  return g;
}

// After zooming, check once whether the set of clusters has changed.
// Only then does it redraw — panning and zooming themselves never do.
function clusterLater() {
  clearTimeout(clusterTimer!); // null until the first zoom; clearTimeout takes it either way
  setClusterTimer(
    setTimeout(() => {
      if (clusterSigOf(buildClusters(uPerPx())) !== clusterSig) renderMap();
    }, 150),
  );
}

function drawCluster(grp: Item[]) {
  const c0 = clusterCenter(grp);
  const g = scaleAt(
    el("g", { class: "marker cluster", "data-ids": grp.map((i) => i.id).join(" ") }, gMark),
    c0.x,
    c0.y,
  );
  const r = 14,
    rr = r + 5;
  // Outer ring: one arc per kind, sized to its share of the cluster. Between
  // two arcs there's a one-screen-pixel gap — without it, red and green
  // would blend together and the ring would read as a single color.
  const gap = 1 / rr; // 1 px at radius rr, in radians
  let a0 = -Math.PI / 2;
  for (const k of KIND_ORDER) {
    const n = grp.filter((i) => i.kind === k).length;
    if (!n) continue;
    if (n === grp.length) {
      el("circle", { class: "ring " + k, r: rr }, g);
      break;
    } // a full circle isn't an arc
    const a1 = a0 + (2 * Math.PI * n) / grp.length,
      b0 = a0 + gap / 2,
      b1 = a1 - gap / 2;
    el(
      "path",
      {
        class: "ring " + k,
        d: `M ${(rr * Math.cos(b0)).toFixed(2)} ${(rr * Math.sin(b0)).toFixed(2)} A ${rr} ${rr} 0 ${b1 - b0 > Math.PI ? 1 : 0} 1 ${(rr * Math.cos(b1)).toFixed(2)} ${(rr * Math.sin(b1)).toFixed(2)}`,
      },
      g,
    );
    a0 = a1;
  }
  el("circle", { class: "body", r }, g);
  // A finding within the cluster belongs on the cluster — otherwise it disappears when zooming out.
  const worst = grp.map((i) => links().status.get(i.id)?.g).find((x) => x === "err") ? "err" : null;
  if (worst) {
    el("circle", { class: "alerthalo", r: rr + 4 }, g);
    el("circle", { class: "alert err", r: rr + 4 }, g);
  }
  el("text", { x: 0, y: 0 }, g).textContent = String(grp.length);
  el("title", {}, g).textContent = grp.map((i) => i.label).join(", ");
  g.addEventListener("pointerdown", (e: PointerEvent) => {
    if (mode !== "select") return;
    e.stopPropagation();
    zoomToCluster(grp);
  });
  return g;
}

// Clicking the cluster means: I want to go in there. 15% margin, at least a 12 m edge —
// otherwise two cameras a meter apart would immediately hit the zoom limit.
export function zoomToCluster(grp: Item[]) {
  const xs = grp.map((i) => i.x),
    ys = grp.map((i) => i.y),
    min = 12 * GEO.pxPerM;
  let x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    y0 = Math.min(...ys),
    y1 = Math.max(...ys);
  const pad = Math.max(x1 - x0, y1 - y0) * 0.15;
  x0 -= pad;
  x1 += pad;
  y0 -= pad;
  y1 += pad;
  if (x1 - x0 < min) {
    const c = (x0 + x1) / 2;
    x0 = c - min / 2;
    x1 = c + min / 2;
  }
  if (y1 - y0 < min) {
    const c = (y0 + y1) / 2;
    y0 = c - min / 2;
    y1 = c + min / 2;
  }
  jumpView(() => {
    fitTo({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    renderMap(); // clusters break apart immediately, not only after debouncing
  });
}

function drawDraft() {
  gDraft.innerHTML = "";
  if (!draft.length) return;
  el("path", { d: draft.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y).join(" ") }, gDraft);
  draft.forEach((p) => el("circle", { r: 4 }, scaleAt(el("g", {}, gDraft), p.x, p.y)));
  const last = draft[draft.length - 1],
    L = polyLength(draft);
  el(
    "text",
    { class: "caption-svg", x: 10, y: 14 },
    scaleAt(el("g", {}, gDraft), last.x, last.y),
  ).textContent = L.toFixed(0) + " m";
}

export function renderMap() {
  syncBonds();
  invalidateLinks(); // positions and bonds may have changed
  gCover.innerHTML = "";
  gCond.innerHTML = "";
  gMark.innerHTML = "";
  gSec.innerHTML = "";
  gLab.innerHTML = "";
  gHand.innerHTML = "";
  setClusters(buildClusters(uPerPx()));
  setClusterSig(clusterSigOf(CLUSTERS));
  const grouped = new Set(CLUSTERS.flatMap((g) => g.map((i) => i.id)));
  // Cones, ranges, and conduits stay put — only the markers get grouped into a cluster.
  state.items.forEach(drawCover);
  state.conduits.forEach(drawConduit);
  state.items.forEach((it) => {
    if (!grouped.has(it.id)) drawMarker(it);
  });
  CLUSTERS.forEach(drawCluster);
  drawHandles();
  drawDraft();
  setHoverKey(""); // the highlighted nodes are gone — otherwise the next hover wouldn't notice
}

export function refreshConduit(c: Conduit) {
  const old = pick(gCond, `g.conduit[data-id="${c.id}"]`);
  if (old) old.remove();
  const ol = pick(gLab, `g.clabels[data-id="${c.id}"]`);
  if (ol) ol.remove();
  gSec.querySelectorAll(`g.csection[data-id="${c.id}"]`).forEach((n: Element) => n.remove());
  drawConduit(c);
  drawHandles();
}

export function refreshItem(it: Item) {
  const oc = pick(gCover, `[data-id="${it.id}"]`);
  if (oc) oc.remove();
  drawCover(it);
  const om = pick(gMark, `.marker[data-id="${it.id}"]`);
  if (om) om.remove();
  if (!clusterOf(it.id)) drawMarker(it); // inside a cluster it has no marker of its own

  for (const c of state.conduits) if (c.points.some((p) => p.at === it.id)) refreshConduit(c);
}

export function wireRender() {
  window.addEventListener("popstate", (e) => {
    const v = e.state && e.state.slView;
    if (
      !v ||
      !["x", "y", "w", "h"].every((k) => typeof v[k] === "number" && isFinite(v[k])) ||
      v.w <= 0
    )
      return;
    popping = true;
    setView({ ...v });
    applyView();
    popping = false;
  });
}
