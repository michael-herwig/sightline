// localStorage, plans, saving, language and adopting a foreign state.
import { renderMap, renderSide, updateHint } from "./hooks";
import { lang, rememberLang, setLangValue, storedLang, t } from "./i18n";
import { GEO_DEFAULT, stampGeo, unstampGeo, useGeo } from "./geo";
import { INFRA } from "./catalogs";
import { condName, isAutoLabel } from "./conduit";
import { migrateConduit, migrateJb } from "./migrate";
import {
  catQuery,
  db,
  dbReady,
  defaultState,
  planId,
  planTitle,
  sameQueries,
  sane,
  setCatFacets,
  setCatQuery,
  setCatTab,
  setLegacyGeo,
  setPlanId,
  setPreview,
  setSel,
  setState,
  state,
} from "./store";
import { CAT_TABS } from "./specs";
import { $, TRASH, applyStatic, esc, h, setStatus } from "./dom";
import { syncBonds } from "./bonds";
import { histInit } from "./history";
import { applyToolLabels } from "./modes";
import { applyBasemap, applyShow, fillBasemapSelect, resetTiles } from "./tiles";
import { restoreView } from "./render";
import { applyLook } from "./look";
import { applyDockLayout, retitlePanels } from "./layout";
import { CURRENT_KEY, INDEX_KEY, LEGACY_KEY, migrateKeys, PLAN_KEY } from "../site/storage";
import type { Lang, State } from "./types";

/** One row of the plan index in localStorage. */
interface PlanEntry {
  id: string;
  name: string;
  updated: number;
  n: number;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function setLang(l: Lang) {
  setLangValue(l === "en" ? "en" : "de");
  state.lang = lang;
  rememberLang(lang);
  applyStatic();
  retitlePanels();
  fillBasemapSelect();
  applyBasemap();
  renderMap();
  renderSide();
  updateHint();
  scheduleSave();
}

// ---------- Multiple plans ----------
// Each plan lives under its own key, alongside a list with name
// and modification time. A single "sl-plan" key would otherwise get silently overwritten
// as soon as you start over from the homepage.
//
// The keys and the one-time oh- → sl- migration are shared with the website, so
// they live in src/site/storage.ts. Re-exported here because the planner modules
// have always got them from this file.
export { CURRENT_KEY, INDEX_KEY, LEGACY_KEY, migrateKeys };

export function planIndex(): PlanEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(INDEX_KEY) || "[]");
    // Foreign JSON: only the array shape is checked, the rows are taken as written.
    return Array.isArray(v) ? (v as PlanEntry[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(list: PlanEntry[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {}
}

export function newPlanId() {
  return "p" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
}

export function readPlan(id: string): Partial<State> | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(PLAN_KEY(id)) || "null");
    // sane() is the gate: past it the save is a plan, though an old one may
    // still lack fields that defaultState() fills in during adopt().
    return sane(v) ? (v as Partial<State>) : null;
  } catch {
    return null;
  }
}

export function touchIndex() {
  if (!planId) return;
  const list = planIndex().filter((e) => e.id !== planId);
  list.unshift({
    id: planId,
    name: (state.name || "").trim(),
    updated: Date.now(),
    n: state.items.length + state.conduits.length,
  });
  writeIndex(list.slice(0, 40));
}

// A save from before the projects feature becomes the first entry in the list.
export function migrateLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    const v = JSON.parse(raw);
    if (sane(v) && !planIndex().length) {
      const id = newPlanId();
      localStorage.setItem(PLAN_KEY(id), raw);
      writeIndex([
        {
          id,
          name: (v.name || "").trim(),
          updated: Date.now(),
          n: v.items.length + v.conduits.length,
        },
      ]);
      localStorage.setItem(CURRENT_KEY, id);
    }
    localStorage.removeItem(LEGACY_KEY);
  } catch {}
}

export function usePlan(id: string, data?: Partial<State> | null) {
  setPlanId(id);
  try {
    localStorage.setItem(CURRENT_KEY, id);
  } catch {}
  adopt(data || defaultState());
  setSel(null);
  setPreview(null);
  renderMap();
  renderSide();
  updateHint();
  buildProjMenu();
}

function switchPlan(id: string) {
  if (id === planId) return;
  const data = readPlan(id);
  if (!data) return;
  usePlan(id, data);
  setStatus(t("plan.switched", { name: (data.name || "").trim() || t("proj.untitled") }));
}

// The seed comes from a JSON file or a share link, already past sane().
export function createPlan(seed?: unknown) {
  usePlan(newPlanId(), (seed as Partial<State>) || defaultState());
  touchIndex();
  scheduleSave();
}

function deletePlan(id: string) {
  const list = planIndex();
  const entry = list.find((e) => e.id === id);
  if (!entry) return;
  if (!confirm(t("plan.del.confirm", { name: entry.name || t("proj.untitled") }))) return;
  try {
    localStorage.removeItem(PLAN_KEY(id));
  } catch {}
  writeIndex(list.filter((e) => e.id !== id));
  if (id === planId) {
    const next = planIndex()[0];
    if (next) usePlan(next.id, readPlan(next.id));
    else createPlan();
  }
  buildProjMenu();
}

const planDate = (ms: number) =>
  new Date(ms).toLocaleString(lang === "de" ? "de-DE" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function buildProjMenu() {
  const box = $("projList");
  if (!box) return;
  box.innerHTML = "";
  planIndex().forEach((e) => {
    const row = h(`<div class="projrow${e.id === planId ? " on" : ""}">
      <button class="pick" type="button"><span class="n">${esc(e.name || t("proj.untitled"))}</span><small>${esc(planDate(e.updated))} · ${e.n || 0}</small></button>
      <button class="del" type="button" title="${esc(t("plan.del"))}" aria-label="${esc(t("plan.del"))}">${TRASH}</button>
    </div>`).firstElementChild as HTMLElement;
    row.querySelector<HTMLElement>(".pick")!.onclick = () => {
      switchPlan(e.id);
      $("projMenu").open = false;
    };
    row.querySelector<HTMLElement>(".del")!.onclick = () => deletePlan(e.id);
    box.appendChild(row);
  });
  if (!planIndex().length)
    box.appendChild(h(`<div class="empty">${esc(t("plan.none"))}</div>`).firstElementChild!);
  const add = h(`<button class="projnew" type="button">${esc(t("plan.new"))}</button>`)
    .firstElementChild as HTMLElement;
  add.onclick = () => {
    createPlan();
    $("projMenu").open = false;
  };
  box.appendChild(add);
}

export function scheduleSave() {
  if (!planId) setPlanId(newPlanId());
  stampGeo(state);
  try {
    // The line above just made sure of it.
    localStorage.setItem(PLAN_KEY(planId!), JSON.stringify(state));
  } catch {}
  touchIndex();
  saveState("dirty", t("status.unsaved"));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 900);
}

async function save() {
  if (!db) {
    saveState("ok", t(dbReady ? "status.localonly" : "status.local"));
    return;
  }
  try {
    // store.ts leaves `db` at its null initialiser; the host object is untyped.
    await db.doc("plan/current").set({ ...state, savedAt: new Date().toISOString() });
    saveState(
      "ok",
      t("status.saved", {
        time: new Date().toLocaleTimeString(lang === "de" ? "de-DE" : "en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      }),
    );
  } catch {
    saveState("fail", t("status.savefail"));
  }
}

function saveState(kind: string, msg: string) {
  const b = $("t-save");
  if (!b) return;
  b.classList.toggle("dirty", kind === "dirty");
  b.classList.toggle("fail", kind === "fail");
  b.title = t("btn.export") + " · " + msg;
}

function adopt(s: Partial<State>) {
  const d = defaultState();
  setState({ ...d, ...s, infra: { ...d.infra, ...s.infra } });
  INFRA.forEach((i) => {
    if (!state.infra[i.id]) state.infra[i.id] = { on: i.on, qty: i.qty };
  });
  state.conduits.forEach((c) => {
    migrateConduit(c);
    if (isAutoLabel(c)) c.label = condName(c);
  });
  state.items.forEach((i) => {
    if (i.kind === "jb") migrateJb(i);
    // Old save: the house connection was an all-in-one without devices.
    else if (i.kind === "hub" && !Array.isArray(i.gear)) i.gear = [];
  });
  setLegacyGeo(!s.geo && (s.items || []).length > 0);
  if (!state.geo) state.geo = { ...GEO_DEFAULT };
  if (useGeo(state.geo) && typeof resetTiles === "function" && $("g-tiles")) resetTiles();
  unstampGeo(state);
  // The switch applies globally. A plan saved with "de" must not
  // revert the choice — otherwise the site jumps back to German on open.
  setLangValue(storedLang() || (state.lang === "en" ? "en" : "de"));
  state.lang = lang;
  setCatQuery(sameQueries(state.catQuery));
  state.catQuery = catQuery;
  setCatTab(CAT_TABS.some((x) => x.id === state.catTab) ? state.catTab : "cam");
  setCatFacets(new Set(Array.isArray(state.catFacets) ? state.catFacets : []));
  state.look = { ...d.look, ...s.look };
  applyStatic();
  applyToolLabels();
  applyShow();
  applyLook();
  fillBasemapSelect();
  applyDockLayout();
  retitlePanels();
  restoreView();
  syncBonds();
  histInit();
}

export function wirePersist() {
  $("t-lang").onclick = () => setLang(lang === "de" ? "en" : "de");

  $("projName").oninput = (e: { target: HTMLInputElement }) => {
    state.name = e.target.value;
    document.title = planTitle() + " · Planer";
    scheduleSave();
  };

  $("projSub").oninput = (e: { target: HTMLInputElement }) => {
    state.sub = e.target.value;
    scheduleSave();
  };

  // Enter or Esc ends the input — otherwise the field stays focused and captures the tool shortcuts.
  ["projName", "projSub"].forEach((id) => {
    $(id).onkeydown = (e: KeyboardEvent & { target: HTMLElement }) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        e.target.blur();
      }
    };
  });

  $("projMenu").addEventListener("toggle", () => {
    if ($("projMenu").open) buildProjMenu();
  });

  document.addEventListener("pointerdown", (e) => {
    const m = $("projMenu");
    if (m && m.open && !m.contains(e.target as Node)) m.open = false;
  });
}
