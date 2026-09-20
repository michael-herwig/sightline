// The dockview panel layout.
import { createDockview } from "dockview";
import { renderSide, scheduleSave } from "./hooks";
import { t } from "./i18n";
import { dock, setDock, state } from "./store";
import { $, DETACHED, esc, h } from "./dom";
import { booted } from "./tiles";
import { applyView } from "./render";

// ---------- Layout: dockview ----------
// At explicit request, a real docking library (dockview, MIT, from npm).
// Panels can be placed side by side,
// stacked, detached, and resized this way; each scrolls independently.
// The layout itself is part of the saved state.
const DOCK_NODES: Record<string, string> = {
  map: "mapwrap",
  sel: "pane-sel",
  build: "pane-build",
  list: "pane-list",
  cost: "pane-cost",
};

const DOCK_TITLE: Record<string, string> = {
  map: "panel.map",
  sel: "panel.sel",
  build: "tab.build",
  list: "tab.list",
  cost: "tab.cost",
};
let dockTimer: ReturnType<typeof setTimeout> | undefined;

// dockview splits the target area 50/50 when redocking. The opposite is expected:
// the existing layout stays, and the moved panel gets back the size
// it had before. So we remember each panel's group size.
// `g`: any — a dockview group object; `dock` itself is untyped (store.ts), so
// nothing reaching it through `dock.panels` carries real types either.
const groupSize = (g: any): { width: number; height: number } | null => {
  if (!g) return null;
  const w = (g.api && g.api.width) || (g.element && g.element.clientWidth) || 0;
  const h = (g.api && g.api.height) || (g.element && g.element.clientHeight) || 0;
  return w > 40 && h > 40 ? { width: Math.round(w), height: Math.round(h) } : null;
};

function recordDockSizes() {
  if (!dock) return;
  const out = { ...state.dockSize };
  for (const pl of dock.panels) {
    const sz = groupSize(pl.group);
    if (sz) out[pl.id] = sz;
  }
  state.dockSize = out;
}

// `panel`: any — a dockview panel object, same reason as groupSize's `g`.
function adoptDropped(panel: any) {
  const g = panel && panel.group;
  // Dropped into an existing group: nothing there gets touched, the panel
  // simply takes on that group's size. Only a freshly opened group gets sized.
  if (!g || !g.panels || g.panels.length !== 1) return;
  const want = (state.dockSize || {})[panel.id];
  if (!want) return;
  try {
    panel.api.setSize(want);
  } catch {}
}

function darkNow() {
  const forced = document.documentElement.getAttribute("data-theme");
  if (forced) return forced === "dark";
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

function defaultDockLayout() {
  dock.addPanel({ id: "map", component: "map", title: t(DOCK_TITLE.map) });
  dock.addPanel({
    id: "build",
    component: "build",
    title: t(DOCK_TITLE.build),
    position: { referencePanel: "map", direction: "right" },
  });
  dock.addPanel({
    id: "sel",
    component: "sel",
    title: t(DOCK_TITLE.sel),
    position: { referencePanel: "build", direction: "above" },
  });
  dock.addPanel({
    id: "list",
    component: "list",
    title: t(DOCK_TITLE.list),
    position: { referencePanel: "build", direction: "within" },
  });
  dock.addPanel({
    id: "cost",
    component: "cost",
    title: t(DOCK_TITLE.cost),
    position: { referencePanel: "build", direction: "within" },
  });
  const b2 = dock.getPanel("build");
  if (b2) {
    b2.api.setActive();
    // Without a size, dockview splits evenly; 360 px is enough for catalog and values.
    try {
      b2.api.setSize({ width: 360 });
    } catch {}
  }
  const s2 = dock.getPanel("sel");
  if (s2) {
    try {
      s2.api.setSize({ height: 320 });
    } catch {}
  }
}

function fallbackLayout(host: HTMLElement) {
  // Without dockview (it throws, no layout at all) a plain stack remains — the
  // planner must stay usable even then.
  host.classList.add("plainlayout");
  Object.values(DOCK_NODES).forEach((id) => {
    const n = $(id);
    if (n) host.appendChild(n);
  });
}

let layoutDone = false;

let layoutFrames = 0;

export function initLayout() {
  if (layoutDone) return;
  const host = $("dock");
  // dockview measures itself through a ResizeObserver, and under load that callback
  // lands after the panels have been added. It then lays the grid out at 0 x 0, every
  // group clamps to its 100 px minimum and never grows back — the map stays a sliver
  // and the panels collapse into one stack. So: wait here for a real measurement of
  // #dock, and hand it to dockview below before the first panel goes in. Only wait
  // where there is layout at all — without it (jsdom) the body measures 0 too, and
  // waiting would mean never coming up. The frame count bounds it either way.
  if (
    host &&
    !host.clientWidth &&
    document.body.clientWidth &&
    ++layoutFrames < 60 &&
    typeof requestAnimationFrame === "function"
  ) {
    requestAnimationFrame(initLayout);
    return;
  }
  layoutDone = true;
  try {
    setDock(
      createDockview(host, {
        className: darkNow() ? "dockview-theme-dark" : "dockview-theme-light",
        createComponent: (o) => ({
          element: $(DOCK_NODES[o.name]) || document.createElement("div"),
          init() {},
        }),
      }),
    );
  } catch {
    setDock(null);
    return fallbackLayout(host);
  }
  // The grid has to know its size before any panel is added — see above. Waiting for
  // dockview's own ResizeObserver is exactly the race; the measurement is already here.
  try {
    dock.layout(host.clientWidth, host.clientHeight);
  } catch {}
  applyView(); // the map now has its final size
  if (!applyDockLayout()) {
    try {
      dock.clear();
    } catch {}
    defaultDockLayout();
  }
  dock.onDidLayoutChange(() => {
    clearTimeout(dockTimer);
    dockTimer = setTimeout(() => {
      recordDockSizes();
      try {
        state.dock = dock.toJSON();
      } catch {
        return;
      }
      if (booted) scheduleSave();
    }, 400);
  });
  if (dock.onDidMovePanel)
    dock.onDidMovePanel((e: any) => {
      // `e`: any — dockview's move-panel event, same reason as groupSize's `g`.
      const pl = e && e.panel;
      if (!pl) return;
      setTimeout(() => adoptDropped(pl), 0); // only once dockview has re-laid its grid
    });
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      host.classList.toggle("dockview-theme-dark", darkNow());
      host.classList.toggle("dockview-theme-light", !darkNow());
    });
  }
}

// Also called after loading a saved state — otherwise the default would stick
// and sizes wouldn't match between two visits.
export function applyDockLayout(): boolean {
  if (!dock || !state.dock) return false;
  try {
    dock.fromJSON(state.dock);
    return dock.panels.length > 0;
  } catch {
    return false;
  }
}

// A closed panel would otherwise be gone. The menu brings it back.
function reopenPanel(id: string) {
  if (!dock) return;
  const there = dock.getPanel(id);
  if (there) {
    there.api.setActive();
    return;
  }
  const host = ["build", "list", "cost", "sel", "map"].map((x) => dock.getPanel(x)).find(Boolean);
  dock.addPanel({
    id,
    component: id,
    title: t(DOCK_TITLE[id]),
    position: host
      ? { referencePanel: host.id, direction: id === "map" ? "left" : "within" }
      : undefined,
  });
  renderSide();
}

function resetLayout() {
  if (!dock) return;
  try {
    dock.clear();
  } catch {}
  defaultDockLayout();
  renderSide();
  applyView();
  scheduleSave();
}

function buildViewMenu() {
  const list = $("viewList");
  if (!list) return;
  list.innerHTML = "";
  Object.keys(DOCK_TITLE).forEach((id) => {
    const on = !!(dock && dock.getPanel(id));
    const b = h(
      `<button class="${on ? "" : "off"}"><span class="mk">✓</span>${esc(t(DOCK_TITLE[id]))}</button>`,
    ).firstElementChild as HTMLElement;
    b.onclick = () => {
      reopenPanel(id);
      $("viewMenu").open = false;
      buildViewMenu();
    };
    list.appendChild(b);
  });
  list.appendChild(h(`<hr>`).firstElementChild);
  const r = h(`<button>${esc(t("view.reset"))}</button>`).firstElementChild as HTMLElement;
  r.onclick = () => {
    resetLayout();
    $("viewMenu").open = false;
    buildViewMenu();
  };
  list.appendChild(r);
}

export function retitlePanels() {
  if (!dock) return;
  for (const id in DOCK_TITLE) {
    const p = dock.getPanel(id);
    if (p) p.api.setTitle(t(DOCK_TITLE[id]));
  }
}

export function wireLayout() {
  Object.values(DOCK_NODES).forEach((id) => {
    const n = document.getElementById(id);
    if (n) DETACHED.push(n);
  });

  $("viewMenu").addEventListener("toggle", () => {
    if ($("viewMenu").open) buildViewMenu();
  });

  document.addEventListener("pointerdown", (e) => {
    const m = $("viewMenu");
    if (m && m.open && !m.contains(e.target)) m.open = false;
  });
}
