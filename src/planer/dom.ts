// @ts-nocheck
// Node access and small DOM helpers. Everything visual goes through here.
import { lang, t } from "./i18n";
import { dock, planTitle, sel, state } from "./store";

// Tab icons: one line icon each, so the category is clear at a glance.
export const ICONS = {
  cam: `<i class="codicon codicon-device-camera" aria-hidden="true"></i>`,
  ap: `<i class="codicon codicon-radio-tower" aria-hidden="true"></i>`,
  jb: `<i class="codicon codicon-plug" aria-hidden="true"></i>`,
  gear: `<i class="codicon codicon-server" aria-hidden="true"></i>`,
  cond: `<i class="codicon codicon-pulse" aria-hidden="true"></i>`,
};

export const LINKOUT = `<i class="codicon codicon-link-external" aria-hidden="true"></i>`;

export const FIND = `<i class="codicon codicon-search" aria-hidden="true"></i>`;

export const EXPAND = `<i class="codicon codicon-screen-full" aria-hidden="true"></i>`;

export const COPY = `<i class="codicon codicon-copy" aria-hidden="true"></i>`;

export const INFO = `<i class="codicon codicon-info" aria-hidden="true"></i>`;

export const PLUS = `<i class="codicon codicon-add" aria-hidden="true"></i>`;

export const TRASH = `<i class="codicon codicon-trash" aria-hidden="true"></i>`;

// dockview detaches inactive panels from the document. The nodes still belong to us,
// so we search inside them if needed — otherwise #pane-list suddenly becomes null.
export const DETACHED = [];

export const $ = (id) => {
  const hit = document.getElementById(id);
  if (hit) return hit;
  for (const root of DETACHED) {
    if (root.id === id) return root;
    const f = root.querySelector(`[id="${id}"]`);
    if (f) return f;
  }
  return null;
};

export const svg = $("svg"),
  mapwrap = $("mapwrap");

export const gSec = $("g-sections"),
  gCover = $("g-cover"),
  gCond = $("g-conduits"),
  gDraft = $("g-draft"),
  gMark = $("g-markers"),
  gLab = $("g-labels"),
  gHand = $("g-handles");

export const fmt = (n) => Math.round(n).toLocaleString(lang === "de" ? "de-DE" : "en-GB") + " €";

export const fmtM = (n) => n.toFixed(0) + " m";

export const NS = "http://www.w3.org/2000/svg";

export const el = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};

// Redraw only what's needed — this is the path that runs while dragging.
export const pick = (group, selector) => group.querySelector(selector);

// dockview re-mounts a panel on activation and calls focus(); both reset
// the panel area's scroll position. So: already active = don't touch it,
// otherwise remember the position and restore it.
function withScroll(fn) {
  const saved = DETACHED.map((n) => [n, n.scrollTop]);
  fn();
  const put = () =>
    saved.forEach(([n, y]) => {
      if (y && n.scrollTop !== y) n.scrollTop = y;
    });
  put();
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(put);
}

export function openPanel(id) {
  const p = dock && dock.getPanel(id);
  if (!p || (p.api && p.api.isActive)) return;
  withScroll(() => p.api.setActive());
}

export function h(html) {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d;
}

export function esc(s) {
  return String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

// ---------- Panels: stable DOM instead of rebuild ----------
// Each panel rebuilds its scaffold only when its signature changes (different
// selection, different model, different hit list). Otherwise only values get
// patched in. This keeps scroll position, focus, and tab order — before, the
// panel used to jump to the top on every click and the selection flickered.
// ponytail: no reactive framework — four signatures are enough for this.
export function pane(id, sig, build) {
  const p = $(id);
  if (!p) return null;
  if (p.dataset.sig !== sig) {
    p.dataset.sig = sig;
    p.innerHTML = "";
    build(p);
  }
  return p;
}

export function setVal(id, v) {
  const e = $(id);
  if (!e || e === document.activeElement) return;
  if (e.type === "checkbox") {
    if (e.checked !== !!v) e.checked = !!v;
  } else if (e.value !== String(v)) e.value = String(v);
}

export function setHtml(id, html) {
  const e = $(id);
  if (e && e.innerHTML !== html) e.innerHTML = html;
}

export function setText(id, txt) {
  const e = $(id);
  if (e && e.textContent !== txt) e.textContent = txt;
}

export const selKey = () => (sel ? sel.kind + ":" + sel.id : "");

export function closeDlg(d) {
  if (!d) return;
  try {
    d.close();
  } catch {
    d.open = false;
  }
}

// A click on the backdrop closes it. That hits the <dialog> itself, so
// additionally check whether the pointer was actually outside the box.
export function closeOnBackdrop(d) {
  if (!d) return;
  d.addEventListener("click", (e) => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      closeDlg(d);
  });
}

// ---------- Language ----------
export function applyStatic() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((e) => {
    e.textContent = t(e.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((e) => {
    e.title = t(e.dataset.i18nTitle);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((e) => {
    e.setAttribute("aria-label", t(e.dataset.i18nAriaLabel));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((e) => {
    e.placeholder = t(e.dataset.i18nPlaceholder);
  });
  applyName();
  $("t-lang").textContent = lang.toUpperCase(); // shows the active language, not the target
}

export function applyName() {
  const el = $("projName"),
    sb = $("projSub");
  if (el && el !== document.activeElement && el.value !== (state.name || ""))
    el.value = state.name || "";
  if (sb && sb !== document.activeElement && sb.value !== (state.sub || ""))
    sb.value = state.sub || "";
  document.title = planTitle() + " · Planer";
}

// Briefly flash events (copied, loaded, switched); the current
// save state travels as a colored dot on the save button, the text into its title.
let toastTimer = null;

export function setStatus(msg) {
  const el = $("toast");
  if (!el) return;
  // An open dialog sits in the topmost layer; go there, otherwise back to the map.
  const dlg = document.querySelector("dialog[open]"),
    home = $("mapwrap");
  const want = dlg || home;
  if (el.parentNode !== want) want.appendChild(el);
  el.classList.toggle("indlg", !!dlg);
  document.querySelectorAll("dialog.toasting").forEach((d) => {
    if (d !== dlg) d.classList.remove("toasting");
  });
  if (dlg) dlg.classList.add("toasting");
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("on");
    document.querySelectorAll("dialog.toasting").forEach((d) => d.classList.remove("toasting"));
  }, 2400);
}
