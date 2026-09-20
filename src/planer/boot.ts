// @ts-nocheck
// Wires the modules together and starts the planner.
import { setHooks } from "./hooks";
import { setLangValue, storedLang, t } from "./i18n";
import {
  catQuery,
  db,
  defaultState,
  legacyGeo,
  planId,
  sameQueries,
  sane,
  setCatFacets,
  setCatQuery,
  setCatTab,
  setDb,
  setDbReady,
  setLegacyGeo,
  state,
} from "./store";
import { CAT_TABS } from "./specs";
import { applyStatic, setStatus } from "./dom";
import { histInit } from "./history";
import { applyToolLabels, updateHint, wireModes } from "./modes";
import { applyShow, fillBasemapSelect, setBooted, wireTiles } from "./tiles";
import { renderMap, restoreView, wireRender } from "./render";
import { applyLook, wireLook } from "./look";
import {
  geoLookup,
  gotoLatLon,
  migrateLegacyGeo,
  seedFromPlace,
  shortPlace,
  wireGeosearch,
} from "./geosearch";
import { wireHover } from "./hover";
import { wireDialogs } from "./dialogs";
import { renderSel } from "./panel-sel";
import { stateFromHash, wireShare } from "./share";
import { renderBuild } from "./panel-build";
import { renderList, wirePanelList } from "./panel-list";
import { renderCost } from "./panel-cost";
import { wireExport } from "./export";
import { wireDrag } from "./drag";
import { initLayout, wireLayout } from "./layout";
import {
  CURRENT_KEY,
  createPlan,
  migrateKeys,
  migrateLegacy,
  newPlanId,
  planIndex,
  readPlan,
  scheduleSave,
  touchIndex,
  usePlan,
  wirePersist,
} from "./persist";

export function renderSide() {
  renderSel();
  renderBuild();
  renderList();
  renderCost();
}

async function boot() {
  migrateKeys(); // before the first read — everything below expects sl-* keys
  // The language comes from the website, not from the plan.
  const pref = storedLang();
  if (pref) {
    setLangValue(pref);
    state.lang = pref;
  }
  setCatQuery(sameQueries(state.catQuery));
  state.catQuery = catQuery;
  setCatTab(CAT_TABS.some((x) => x.id === state.catTab) ? state.catTab : "cam");
  setCatFacets(new Set(Array.isArray(state.catFacets) ? state.catFacets : []));
  applyStatic();
  applyToolLabels();
  applyShow();
  applyLook();
  fillBasemapSelect();
  initLayout();
  restoreView();
  renderMap();
  renderSide();
  updateHint();
  histInit();
  setTimeout(() => {
    if (legacyGeo) {
      setLegacyGeo(false);
      migrateLegacyGeo();
    }
  }, 0);
  // The URL carries the intent: new plan, specific plan, or a shared save.
  migrateLegacy();
  const hash = location.hash || "";
  const wantNew = /[#&]new=1/.test(hash);
  const openId = (/[#&]o=([A-Za-z0-9_-]+)/.exec(hash) || [])[1];
  const addr = (/[#&]q=([^&]+)/.exec(hash) || [])[1];
  const ll = /[#&]ll=(-?[\d.]+),(-?[\d.]+)/.exec(hash);
  const label = (/[#&]n=([^&]+)/.exec(hash) || [])[1];
  const fromLink = await stateFromHash();
  try {
    if (hash) history.replaceState(null, "", location.pathname);
  } catch {}

  let hadLocal = false;
  if (sane(fromLink)) {
    // A shared link becomes its own plan — it never overwrites someone else's.
    usePlan(newPlanId(), fromLink);
    touchIndex();
    scheduleSave();
    setStatus(t("share.loaded"));
    hadLocal = true;
  } else if (wantNew) {
    createPlan();
    setStatus(t("status.ready"));
    hadLocal = true; // otherwise the server save would lay its plan over the fresh one
  } else {
    let id = openId && readPlan(openId) ? openId : null;
    if (!id) {
      try {
        const cur = localStorage.getItem(CURRENT_KEY);
        if (cur && readPlan(cur)) id = cur;
      } catch {}
    }
    if (!id) {
      const first = planIndex().find((e) => readPlan(e.id));
      if (first) id = first.id;
    }
    if (id) {
      usePlan(id, readPlan(id));
      setStatus(t("status.loadedlocal"));
      hadLocal = true;
    } else {
      usePlan(newPlanId(), defaultState());
    }
  }

  try {
    // The deploy is static — there is no endpoint. Only the optional
    // window.claude host provides a store; otherwise `db` stays null and
    // everything runs on localStorage, share link and JSON export.
    setDb(window.claude && window.claude.use ? await window.claude.use("db") : null);
    setDbReady(true);
    // The server has only one slot. So it may only step in when the
    // browser has nothing at all — otherwise it would overwrite the just-selected plan.
    if (db && !hadLocal) {
      const snap = await db.doc("plan/current").get();
      if (snap.exists && sane(snap.data())) {
        usePlan(planId, snap.data());
        setStatus(t("status.loaded"));
      } else setStatus(t("status.ready"));
    } else setStatus(t(hadLocal ? "status.loadedlocal" : "status.ready"));
  } catch {
    setStatus(t("status.nocloud"));
  }
  // Arrived from the homepage with a location: jump there — and for a
  // fresh plan, fill in the house connection, name, address, and parcel right away.
  let place = null;
  if (ll) place = { lat: +ll[1], lon: +ll[2], label: label ? decodeURIComponent(label) : "" };
  else if (addr) {
    try {
      const hits = await geoLookup(decodeURIComponent(addr));
      if (hits && hits.length)
        place = { lat: +hits[0].lat, lon: +hits[0].lon, label: shortPlace(hits[0]) };
      else setStatus(t("geo.none"));
    } catch {
      setStatus(t("geo.failed"));
    }
  }
  if (place) {
    if (wantNew) await seedFromPlace(place);
    else {
      gotoLatLon(place.lat, place.lon);
      if (place.label) setStatus(place.label);
    }
  }
  setBooted(true);
}

// Fill the late-bound slots before anything can fire (see hooks.ts).
setHooks({ renderMap, renderSide, scheduleSave, updateHint, createPlan });

// Top-level side effects of the old IIFE, one wire function per module, in the
// order they used to run in.
wireTiles();
wireLook();
wireGeosearch();
wireRender();
wireDrag();
wireModes();
wireLayout();
wireDialogs();
wireHover();
wirePanelList();
wireExport();
wirePersist();
wireShare();

boot();
