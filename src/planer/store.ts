// @ts-nocheck
// The working state and every binding that more than one module writes.
import { t } from "./i18n";
import { H, W } from "./geo";
import { CATALOG, INFRA, SHOPS } from "./catalogs";

// ---------- Default plan (the proposal from the conversation) ----------
// The planner starts empty. No example property, no foreign addresses —
// whoever starts first searches a location, then places their house connection.
export function defaultState() {
  const infra = {};
  INFRA.forEach((i) => {
    infra[i.id] = { on: i.on, qty: i.qty };
  });
  return {
    items: [],
    conduits: [],
    infra,
    budget: 3000,
    earthwork: 0,
    seq: 0,
    lang: "de",
    basemap: "dop",
    overlay: true,
    view: null,
    name: "",
    sub: "",
    shop: "",
    dock: null,
    dockSize: {},
    geo: { e0: 356448.6, n0: 5645366.7 },
    show: { cones: true, rings: true, conds: true, labels: true, sections: true },
    look: { size: 1, font: 1, alpha: 1, line: 1, cluster: true },
    catTab: "cam",
    catQuery: { cam: "", ap: "", jb: "", gear: "", cond: "" },
    catFacets: [],
    toolLabels: false,
  };
}

// ---------- State ----------
export let state = defaultState();

export let sel = null; // { kind: "item"|"conduit", id }

export let mode = "select"; // select | place-cam | place-ap | place-jb | draw

export let placeModel = "g6-bullet";

export let placeAp = "u7-outdoor";

export let placeJb = "shaft";

export let drawType = "fiber";

export let draft = []; // points while drawing

export let view = { x: 0, y: 0, w: W, h: H };
export let db = null,
  dbReady = false;

export let preview = null; // { kind, key } — catalog entry in the selection panel

export let catTab = "cam"; // active catalog tab

export let catQuery = { cam: "", ap: "", jb: "", gear: "", cond: "" }; // search text per tab

export let catFacets = new Set(); // active filter badges (identifiers are unique)

export const sameQueries = (q) => {
  const out = { cam: "", ap: "", jb: "", gear: "", cond: "" };
  if (typeof q === "string") out.cam = q; // old format: one field for everything
  else if (q && typeof q === "object")
    for (const k in out) if (typeof q[k] === "string") out[k] = q[k];
  return out;
};

// Product image: optional. Whoever places /public/products/<kind>-<key>.jpg sees it;
// if the file is missing, onerror hides the image and the layout stays unchanged.
// Image preferably comes from the catalog (address from the manufacturer CDN, see
// tools/fetch-images.mjs); placing local copies gains nothing —
// then just remove img: and public/products/ takes over.
// Last used retailer — the selection is already there for the next product.
export const shopOf = () => SHOPS.find((x) => x.label === state.shop) || SHOPS[0];

// ---------- Appearance: gear icon under the eye ----------
// Pure visuals — symbol size, font, areas, line width, clusters. Three of these
// are CSS variables on the SVG (and thus travel along in export and print), two are
// factors in drawing. None of this belongs in HIST_KEYS: a slider is not a work
// step, and an undo must not change the view.
export const LOOK_DEF = { size: 1, font: 1, alpha: 1, line: 1, cluster: true };

export const LOOK_RANGE = { size: [0.6, 1.6], font: [0.7, 1.5], alpha: [0, 1], line: [0.6, 1.6] };

export let LOOK = { ...LOOK_DEF };

// ---------- Drag / pan ----------
export let drag = null;

export function uid() {
  state.seq = (state.seq || 0) + 1;
  return "e" + Date.now().toString(36) + state.seq;
}

export function nextLabel(prefix) {
  let n = 1;
  const used = new Set(state.items.map((i) => i.label));
  while (used.has(prefix + n)) n++;
  return prefix + n;
}
export let dock = null;

// ---------- Project name ----------
export function planTitle() {
  return (state.name || "").trim() || t("proj.untitled");
}

export const planSub = () => (state.sub || "").trim() || t("brand.sub");

// ---------- Load, save, share ----------
export function planFile() {
  return ((state.name || "plan").trim().replace(/[^\w.-]+/g, "-") || "plan") + ".json";
}

export let planId = null;

export let legacyGeo = false;

export function sane(s) {
  return (
    s &&
    Array.isArray(s.items) &&
    Array.isArray(s.conduits) &&
    s.items.every((i) => i.kind === "hub" || (CATALOG[i.kind] && CATALOG[i.kind][i.model])) &&
    s.conduits.every((c) => Array.isArray(c.points) && c.points.length >= 2)
  );
}

// Written from other modules; ES module bindings are read-only for importers.
export const setLookCache = (v) => {
  LOOK = v;
};
export const setCatFacets = (v) => {
  catFacets = v;
};
export const setCatQuery = (v) => {
  catQuery = v;
};
export const setCatTab = (v) => {
  catTab = v;
};
export const setDb = (v) => {
  db = v;
};
export const setDbReady = (v) => {
  dbReady = v;
};
export const setDock = (v) => {
  dock = v;
};
export const setDraft = (v) => {
  draft = v;
};
export const setDrag = (v) => {
  drag = v;
};
export const setDrawType = (v) => {
  drawType = v;
};
export const setLegacyGeo = (v) => {
  legacyGeo = v;
};
export const setModeName = (v) => {
  mode = v;
};
export const setPlaceAp = (v) => {
  placeAp = v;
};
export const setPlaceJb = (v) => {
  placeJb = v;
};
export const setPlaceModel = (v) => {
  placeModel = v;
};
export const setPlanId = (v) => {
  planId = v;
};
export const setPreview = (v) => {
  preview = v;
};
export const setSel = (v) => {
  sel = v;
};
export const setState = (v) => {
  state = v;
};
export const setView = (v) => {
  view = v;
};
