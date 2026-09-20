// @ts-nocheck
// The catalogue lists in the build panel: search, facets, cards.
import { lang, t, tx } from "./i18n";
import {
  APS,
  CABLES,
  CAMS,
  CONDUITS,
  INFRA,
  JUNCTIONS,
  VENDORS,
  isDevice,
  isHousing,
  vendorOf,
} from "./catalogs";
import { condCables, isCableRun, pipeRate } from "./conduit";
import {
  catFacets,
  catQuery,
  catTab,
  drawType,
  mode,
  placeAp,
  placeJb,
  placeModel,
  sel,
  setDrawType,
  setPlaceAp,
  setPlaceJb,
  setPlaceModel,
  setPreview,
  state,
} from "./store";
import { CAT_TABS, FACETS, FACETS_AP, FACETS_GEAR, FACETS_JB } from "./specs";
import { $, INFO, esc, h, setStatus } from "./dom";
import { changed } from "./history";
import { select, setMode } from "./modes";
import { showInfo, showProductInfo } from "./dialogs";

// ---------- Build: catalog with search and filter badges ----------
function matchesQuery(m, key, q) {
  if (!q) return true;
  // Both language variants for indoor/outdoor, so "outdoor" also matches in the German
  // UI (and vice versa).
  const side = m.out === undefined ? "" : m.out ? "außen aussen outdoor" : "innen indoor";
  const hay = [
    tx(m.name),
    key,
    VENDORS[vendorOf(m)],
    m.res,
    tx(m.poe),
    m.ip,
    m.wifi,
    tx(m.mount),
    tx(m.sub),
    tx(m.note),
    side,
    (tx(m.tags) || []).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

// Only filter the badges of the active tab — the ids are unique.
function matchesFacets(m, set) {
  for (const f of set) if (catFacets.has(f.id) && !f.test(m)) return false;
  return true;
}

// Card plus ⓘ top right: shows the datasheet without adding anything.
// Sibling of the card, layered over it via CSS — a button inside a button would be
// invalid HTML, and this way the click never hits the place/add path.
function catCard(card, kind, key, onInfo) {
  const row = h(`<div class="itemrow" data-hover="${kind}:${esc(key)}"></div>`).firstElementChild;
  row.appendChild(card);
  const i = h(
    `<button class="btn icon iteminfo" title="${esc(t("info.title"))}" aria-label="${esc(t("info.title"))}">${INFO}</button>`,
  ).firstElementChild;
  i.onclick = (e) => {
    e.stopPropagation();
    (onInfo || (() => showProductInfo(kind, key)))();
  };
  row.appendChild(i);
  return row;
}

function catButton(kind, key, m, extra) {
  return h(`<button class="item" data-kind="${kind}" data-key="${esc(key)}">
    <span class="n">${esc(tx(m.name))}</span><span class="p">${m.price} €</span>
    <span class="d">${esc(extra)}</span>
    ${m.tags ? `<span class="tags">${(tx(m.tags) || []).map((x) => `<span class="tag ${/kein PoE|no PoE|WLAN|Wi-Fi|Strom nötig|needs power|Erdarbeit|earthwork|nicht mehr zugänglich|not reachable|keine Glasfaser|no fibre|Fachbetrieb|specialist|kein NVR|no NVR/.test(x) ? "w" : ""}">${esc(x)}</span>`).join("")}</span>` : ""}
  </button>`).firstElementChild;
}

// Which button looks pressed depends only on the mode — the list doesn't
// need to be rebuilt for that. That's exactly what broke the scroll position.
export function syncPressed(root) {
  const cur = {
    cam: mode === "place-cam" && placeModel,
    ap: mode === "place-ap" && placeAp,
    jb: mode === "place-jb" && placeJb,
    cond: mode === "draw" && drawType,
  };
  // The hub has no place mode; a permanently wrong
  // aria-pressed turned the button into a switch that never turns on.
  root.querySelectorAll("[data-kind][data-key]").forEach((b) => {
    if (b.dataset.kind === "gear") return;
    b.setAttribute("aria-pressed", String(cur[b.dataset.kind] === b.dataset.key));
  });
}

const catSig = () =>
  `${lang}|${catTab}|${catQuery[catTab] || ""}|${[...catFacets].sort().join(",")}`;

function fillList(id, sig, keys, make) {
  const box = $(id);
  if (!box) return;
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.innerHTML = "";
  if (!keys.length) {
    box.appendChild(h(`<div class="empty">${esc(t("cat.none"))}</div>`).firstElementChild);
    return;
  }
  keys.forEach((k) => box.appendChild(make(k)));
}

function fillCams() {
  const q = catQuery.cam,
    set = FACETS_AP && FACETS;
  fillList(
    "cat-cams",
    catSig(),
    Object.keys(CAMS).filter((k) => matchesQuery(CAMS[k], k, q) && matchesFacets(CAMS[k], set)),
    (k) => {
      const m = CAMS[k];
      const b = catButton(
        "cam",
        k,
        m,
        `${m.res} · ${m.fov >= 360 ? "PTZ" : m.fov + "°"} · IR ${m.ir} m · ${t(m.out ? "spec.outdoor" : "spec.indoor")}`,
      );
      b.onclick = () => {
        setPlaceModel(k);
        setPreview({ kind: "cam", key: k });
        setMode("place-cam");
      };
      return catCard(b, "cam", k);
    },
  );
}

function fillAps() {
  const q = catQuery.ap;
  fillList(
    "cat-aps",
    catSig(),
    Object.keys(APS).filter((k) => matchesQuery(APS[k], k, q) && matchesFacets(APS[k], FACETS_AP)),
    (k) => {
      const a = APS[k];
      const b = catButton(
        "ap",
        k,
        a,
        `${a.wifi} · ~${a.radius} m · ${t(a.out ? "spec.outdoor" : "spec.indoor")}`,
      );
      b.onclick = () => {
        setPlaceAp(k);
        setPreview({ kind: "ap", key: k });
        setMode("place-ap");
      };
      return catCard(b, "ap", k);
    },
  );
}

// A device belongs at a point. If one is selected, it moves there; otherwise
// it gets placed and brings its own point along.
export function addGear(it, key) {
  it.gear = it.gear || [];
  const e = it.gear.find((g) => g.model === key);
  if (e) e.n++;
  else it.gear.push({ model: key, n: 1 });
  changed();
  setStatus(t("jb.gear.added", { name: tx(JUNCTIONS[key].name), label: it.label }));
}

function clickJb(k) {
  const it = sel && sel.kind === "item" ? state.items.find((i) => i.id === sel.id) : null;
  if (isDevice(k) && it && (it.kind === "jb" || it.kind === "hub")) return addGear(it, k);
  setPlaceJb(k);
  setPreview({ kind: "jb", key: k });
  setMode("place-jb");
}

// Two groups in one list: first the locations, then what goes into them.
// The subheadings travel through fillList() as pseudo-keys.
function fillJbs() {
  const q = catQuery.jb;
  const hit = Object.keys(JUNCTIONS).filter(
    (k) => matchesQuery(JUNCTIONS[k], k, q) && matchesFacets(JUNCTIONS[k], FACETS_JB),
  );
  const hous = hit.filter(isHousing),
    dev = hit.filter(isDevice);
  const keys = [].concat(hous.length ? ["#housing"] : [], hous, dev.length ? ["#gear"] : [], dev);
  fillList("cat-jbs", catSig(), keys, (k) => {
    if (k[0] === "#")
      return h(`<h3 class="subhead">${esc(t("cat.jb." + k.slice(1)))}</h3>`).firstElementChild;
    const j = JUNCTIONS[k];
    const b = catButton("jb", k, j, tx(j.use));
    b.onclick = () => clickJb(k);
    return catCard(b, "jb", k);
  });
}

// Hub and accessories: no place mode. A click increments the count by one
// and puts the item in the selection panel.
function fillGear() {
  const q = catQuery.gear;
  const vis = INFRA.filter((i) => !i.hidden);
  fillList(
    "cat-gear",
    catSig(),
    vis.filter((i) => matchesQuery(i, i.id, q) && matchesFacets(i, FACETS_GEAR)).map((i) => i.id),
    (k) => {
      const m = vis.find((i) => i.id === k);
      const b = catButton("gear", k, m, tx(m.sub));
      b.onclick = () => {
        const cur = state.infra[k] || { on: false, qty: 1 };
        state.infra[k] = { on: true, qty: (cur.on ? cur.qty || 0 : 0) + 1 };
        select({ kind: "infra", id: k });
        changed();
      };
      return catCard(b, "gear", k);
    },
  );
}

// Two groups: trenches with ducts, then cable runs without a duct. The sub-
// headings travel through fillList() as pseudo-keys, as with the junctions.
function fillConds() {
  const q = catQuery.cond;
  const hit = Object.keys(CONDUITS).filter((k) => matchesQuery(CONDUITS[k], k, q));
  const tr = hit.filter((k) => !isCableRun(CONDUITS[k])),
    cb = hit.filter((k) => isCableRun(CONDUITS[k]));
  const keys = [].concat(tr.length ? ["#trench"] : [], tr, cb.length ? ["#cable"] : [], cb);
  fillList("cat-cond", catSig(), keys, (k) => {
    if (k[0] === "#")
      return h(`<h3 class="subhead">${esc(t("cat." + k.slice(1)))}</h3>`).firstElementChild;
    const ct = CONDUITS[k];
    const cabs = condCables(ct),
      perM = pipeRate(ct) + cabs.reduce((a, x) => a + CABLES[x.type].m * x.n, 0);
    const lead = cabs[0] && CABLES[cabs[0].type];
    const b = h(
      `<button class="item" data-kind="cond" data-key="${k}"><span class="n">${esc(tx(ct.name))}</span><span class="p">${perM.toFixed(2)} €/m</span><span class="d">${esc(lead ? tx(lead.note) : t("cat.cond.spare"))}</span></button>`,
    ).firstElementChild;
    b.onclick = () => {
      setDrawType(k);
      setPreview({ kind: "cond", key: k });
      setMode("draw");
    };
    // A template has no datasheet of its own: the ⓘ shows the cable inside it,
    // for an empty spare duct the buying advice for the tab.
    return catCard(
      b,
      "cond",
      k,
      cabs[0]
        ? () => showProductInfo("cable", cabs[0].type)
        : () => showInfo(CAT_TABS.find((x) => x.id === "cond")),
    );
  });
}

export const FILL = { cam: fillCams, ap: fillAps, jb: fillJbs, gear: fillGear, cond: fillConds };
