// @ts-nocheck
// Viewport primitives: screen scale, transforms, measurement, drag start.
import { GEO, PX_PER_M } from "./geo";
import { APS, CAMS } from "./catalogs";
import { LOOK, setDrag, state, view } from "./store";
import { mapwrap, svg } from "./dom";

// ---------- Rendering: map ----------
// Symbols stay screen-sized. Everything that's a symbol and not an area —
// markers, clusters, point handles, conduit labels, draft — carries
// `translate(x y) scale(SCALE)` and its anchor point as data-sx/data-sy.
// Cones of view and ranges stay to scale, since they state something about meters.
// Never fixed map units for a symbol: zoomed far out it'd be unreadable, zoomed far in huge.
export const svgW = () => svg.clientWidth || 800;

// Map units per screen point — clusters, offset paths, and the badge compute with this.
export const uPerPx = () => view.w / svgW();

// Target radius on screen: 12 px from 2 px/m, linearly down to 7 px at 0.2 px/m.
// Markers are drawn in their own coordinate system with r = 12, hence /12.
export function calcScale() {
  const k = view.w / svgW(); // map units per screen point
  const pxPerM = PX_PER_M / k;
  const u = Math.max(0, Math.min(1, (pxPerM - 0.2) / 1.8));
  return ((k * (7 + 5 * u)) / 12) * LOOK.size;
}

export let SCALE = 1;

export const markerTransform = (p, rot) =>
  `translate(${p.x} ${p.y}) scale(${SCALE})` + (rot == null ? "" : ` rotate(${rot})`);

// Remember the anchor so refreshScale() can update the transform without redrawing.
export function scaleAt(node, x, y, rot) {
  node.dataset.sx = x;
  node.dataset.sy = y;
  if (rot != null) node.dataset.srot = rot;
  node.setAttribute("transform", markerTransform({ x, y }, rot));
  return node;
}

// The SVG has no preserveAspectRatio override, so the viewBox must exactly match the
// element's aspect ratio. Otherwise the browser re-centers the viewport
// as soon as the width changes — and the whole map jumps.
export function syncAspect() {
  const w = svg.clientWidth || 1,
    h = svg.clientHeight || 1;
  const want = view.w * (h / w);
  if (Math.abs(want - view.h) > 0.01) {
    view.y += (view.h - want) / 2;
    view.h = want;
  }
}

// ---------- View jumps in the browser history ----------
// A *jump* (clicking a cluster, a row in the list or selection, ⌂, an address hit) records the
// view beforehand into the history: Back and Forward then page through the views.
// Panning and zooming don't do this — that would be hundreds of entries per minute.
// The address stays untouched: pushState/replaceState without a URL leave path and hash
// as is, so the share link (#p=) and #new=1 don't get mixed up.
export const canHistory = () => {
  try {
    return !!(window.history && history.pushState);
  } catch {
    return false;
  }
};

export const viewState = () => ({ x: view.x, y: view.y, w: view.w, h: view.h });

// ⌂ shows the plan itself, as long as one exists — otherwise the overview.
export function contentBox() {
  const xs = [],
    ys = [];
  // Ranges and cones of view belong in the box too, otherwise "whole plan" clips the rings.
  state.items.forEach((i) => {
    let r = 0;
    if (i.kind === "ap" && APS[i.model] && (i.rings || "both") !== "none")
      r = APS[i.model].radius * PX_PER_M;
    if (i.kind === "cam" && CAMS[i.model]) r = CAMS[i.model].ir * PX_PER_M;
    xs.push(i.x - r, i.x + r);
    ys.push(i.y - r, i.y + r);
  });
  state.conduits.forEach((c) =>
    c.points.forEach((q) => {
      xs.push(q.x);
      ys.push(q.y);
    }),
  );
  if (!xs.length) return null;
  // Margin 15 m, at least 80 m edge — a single house shouldn't fill the whole screen.
  const pad = 15 * GEO.pxPerM,
    min = 80 * GEO.pxPerM;
  let x0 = Math.min(...xs) - pad,
    x1 = Math.max(...xs) + pad,
    y0 = Math.min(...ys) - pad,
    y1 = Math.max(...ys) + pad;
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
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function toSvg(evt) {
  const p = svg.createSVGPoint();
  p.x = evt.clientX;
  p.y = evt.clientY;
  const m = svg.getScreenCTM().inverse();
  const q = p.matrixTransform(m);
  return { x: q.x, y: q.y };
}

export function startDrag(e, target) {
  const p = toSvg(e);
  setDrag({
    target,
    sx: p.x,
    sy: p.y,
    moved: false,
    orig:
      target.type === "vtx"
        ? { ...target.c.points[target.idx] }
        : { x: target.it.x, y: target.it.y },
    orot: target.type === "rot" ? target.it.rot : 0,
  });
  if (target.type === "rot") mapwrap.classList.add("rotating");
  try {
    if (mapwrap.setPointerCapture) mapwrap.setPointerCapture(e.pointerId);
  } catch {}
}

// Written from other modules; ES module bindings are read-only for importers.
export const setScale = (v) => {
  SCALE = v;
};
