// Selection panel: fields, lists, connection status, recommendations.
import { scheduleSave } from "./hooks";
import { lang, t, tx } from "./i18n";
import { pxLatLon } from "./geo";
import {
  CABLES,
  CATALOG,
  CONDUITS,
  INFRA,
  JUNCTIONS,
  KIND_PREFIX,
  PIPES,
  VENDORS,
  WAN,
  catEntry,
  isDevice,
  isHousing,
  modelOf,
  vendorOf,
  wanOf,
} from "./catalogs";
import {
  condCables,
  condDucts,
  condName,
  condPipes,
  ductCables,
  isCableRun,
  pipeRate,
} from "./conduit";
import { migrateConduit } from "./migrate";
import { nextLabel, preview, sel, setSel, state, uid } from "./store";
import {
  ROUTERS,
  gearNames,
  hubPoe,
  hubRouter,
  hubSfp,
  jbGear,
  jbMains,
  jbPoe,
  jbSfp,
  powerIn,
} from "./gear";
import { CAT_TABS, optHint, whenOf } from "./specs";
import { linkText, links, mainsAt } from "./links";
import { conduitCost } from "./costs";
import {
  $,
  COPY,
  INFO,
  PLUS,
  TRASH,
  applyName,
  esc,
  fmt,
  h,
  pane,
  setHtml,
  setStatus,
  setText,
  setVal,
} from "./dom";
import { changed, condEdit } from "./history";
import { deleteSelected, select } from "./modes";
import { hoverSel } from "./hover";
import { refreshItem } from "./render";
import { geoReverse, parcelAt, shortAddress } from "./geosearch";
import { productBox, showGuide, showInfo, showProductInfo, specList } from "./dialogs";
import { addGear } from "./catalog";
import type { Conduit, Gear, InfraItem, Item, Junction, Model, PipeType, Wan } from "./types";

// ---------- Ribbon: selection properties ----------
// Jump target inside the selection panel. The box gets patched via setHtml, so
// the listener hangs off the document (see data-goto further below), not the button.
const goLink = (kind: string, id: string, txt: string) =>
  `<button class="golink" data-goto="${kind}:${esc(id)}">${esc(txt)}</button>`;

export const fmtW = (v: number) => {
  const s = String(+v.toFixed(1));
  return lang === "de" ? s.replace(".", ",") : s;
};

// Connection status, PoE budget, and the conduits ending here — rows for <dl class="spec">.
function linkHtml(it: Item) {
  const L = links(),
    st = L.status.get(it.id),
    g = L.gear.get(it.id),
    rows = [];
  const mk = (s: string) => (s === "ok" ? "✓" : "!");
  const cls = (s: string) => (s === "err" ? "warn" : s);
  if (st)
    rows.push(
      `<dt>${esc(t(it.kind === "hub" ? "link.hub" : it.kind === "jb" ? "link.uplink" : "link.state"))}</dt>` +
        `<dd class="${cls(st.g)}"><span class="mk">${mk(st.g)}</span>${esc(linkText(st))}</dd>`,
    );
  if (g) {
    rows.push(
      `<dt>${esc(t("link.poe"))}</dt><dd class="${g.over ? "warn" : "ok"}">` +
        `<span class="mk">${mk(g.over ? "warn" : "ok")}</span>${esc(t("link.poe.v", { used: fmtW(g.watts), budget: g.poe }))}</dd>`,
    );
    rows.push(
      `<dt>${esc(t("link.ports"))}</dt><dd class="${g.portsOver ? "warn" : "ok"}">` +
        `<span class="mk">${mk(g.portsOver ? "warn" : "ok")}</span>${esc(t("link.ports.v", { n: g.used, ports: g.ports }))}</dd>`,
    );
    rows.push(
      `<dt>${esc(t("link.devices"))}</dt><dd class="${g.devices.length ? "" : "none"}">` +
        (g.devices.length
          ? g.devices
              .map((d: Item) =>
                goLink(
                  "item",
                  d.id,
                  `${d.label} · ${d.kind === "jb" ? gearNames(d) || tx(modelOf(d).name) : tx(modelOf(d).name)}`,
                ),
              )
              .join("")
          : esc(t("link.none.dev"))) +
        `</dd>`,
    );
  }
  const cs = L.touch.get(it.id) || [];
  rows.push(
    `<dt>${esc(t("link.conds"))}</dt><dd class="${cs.length ? "" : "none"}">` +
      (cs.length
        ? cs
            .map((c: Conduit) =>
              goLink(
                "conduit",
                c.id,
                `${c.label} · ${condName(c)} · ${conduitCost(c).len.toFixed(0)} m`,
              ),
            )
            .join("")
        : esc(t("link.none.dev"))) +
      `</dd>`,
  );
  return rows.join("");
}

function condStatsHtml(c: Conduit) {
  const cc = conduitCost(c);
  // Cat6A only carries up to 90 m — that's the only length that deserves a warning here.
  const cabs = condCables(c),
    catN = cabs.some((x) => x.type === "cat");
  const lenG = catN ? (cc.len > CABLES.cat.max! ? "warn" : "ok") : "";
  const cabTxt = cabs.map((x) => `${x.n} × ${tx(CABLES[x.type].name)}`).join(", ") || "–";
  // A cable run has neither duct nor earthwork — both rows show a dash there.
  const pipeTxt = condPipes(c)
    .map((p) => `${p.n} × ${tx(PIPES[p.pipe].name)}`)
    .join(", ");
  return `<dt>${esc(t("spec.len"))}</dt><dd class="${lenG}">${lenG ? `<span class="mk">${lenG === "ok" ? "✓" : "!"}</span>` : ""}${cc.len.toFixed(1)} m</dd>
    <dt>${esc(t("spec.pipe"))}</dt><dd>${pipeTxt ? `${fmt(cc.pipe)} (${esc(pipeTxt)}, ${pipeRate(c).toFixed(2)} €/m)` : "–"}</dd>
    <dt>${esc(t("spec.cable"))}</dt><dd>${fmt(cc.cable)} (${esc(cabTxt)})</dd>
    <dt>${esc(t("spec.fixed"))}</dt><dd>${fmt(cc.fixed)}</dd>
    <dt>${esc(t("spec.earth"))}</dt><dd>${!isCableRun(c) && state.earthwork ? fmt(cc.earth) : "–"}</dd>
    <dt>${esc(t("spec.sum"))}</dt><dd><b>${fmt(cc.total)}</b></dd>`;
}

export function renderSel() {
  const it = sel && sel.kind === "item" ? state.items.find((i) => i.id === sel!.id) : null;
  const c = sel && sel.kind === "conduit" ? state.conduits.find((x) => x.id === sel!.id) : null;
  // Hub and accessories: a catalog entry with no position on the map.
  const gi = sel && sel.kind === "infra" ? INFRA.find((x) => x.id === sel!.id && !x.hidden) : null;
  if (sel && !it && !c && !gi) setSel(null);
  const sig = !sel
    ? "empty"
    : gi
      ? `gear:${gi.id}:${lang}`
      : // The device list belongs in the signature (only the models, not the quantities —
        // otherwise every quantity change would rebuild the panel and focus would jump).
        // The housing isn't part of it: it only changes the selection in the select.
        it
        ? `item:${it.id}:${it.kind}:${it.kind === "jb" ? "" : it.model || (it.wan && it.wan.type) || ""}:${jbGear(
            it,
          )
            .map((g) => g.model)
            .join("-")}:${lang}`
        : `cond:${c!.id}:${c!.kind}:${condDucts(c!)
            .map((d) =>
              ductCables(d)
                .map((x) => x.type)
                .join("-"),
            )
            .join("|")}:${lang}`;

  const pv = !sel && preview && previewModel(preview) ? preview : null;
  const sig2 = sel ? sig : pv ? `prev:${pv.kind}:${pv.key}:${lang}` : "empty";
  const rib = pane("pane-sel", sig2, (root) => {
    if (!sel) {
      if (pv) return buildPreview(root, pv);
      root.appendChild(h(`<p class="note">${esc(t("panel.empty"))}</p>`));
      return;
    }
    if (gi) return buildGearSel(root, gi);
    if (it) return buildItemSel(root, it);
    buildCondSel(root, c!);
  });
  if (!rib || !sel) return;

  if (gi) {
    const s0 = state.infra[gi.id] || { on: true, qty: 1 };
    setText("f-head", t("sel.head", { label: tx(gi.name) }));
    setVal("f-qty", Math.max(1, s0.qty || 1));
    setText("f-gsum", fmt(gi.price * Math.max(1, s0.qty || 1)));
    return;
  }
  if (it) {
    setText("f-head", t("sel.head", { label: it.label }));
    setVal("f-label", it.label);
    setVal("f-note", it.note || "");
    if (it.kind === "cam") {
      setVal("f-rot", it.rot);
      setText("f-rot-val", t("f.rot.val", { n: it.rot! }));
    }
    jbGear(it).forEach((g, i) => {
      setVal("f-gear-" + i, g.n);
      setText("f-gearp-" + i, gearRowPrice(g));
    });
    setHtml("f-link", linkHtml(it));
    if (it.kind === "jb") {
      setVal("f-model", it.model);
      const adv = jbAdvice(it),
        box = $("f-jb-advice");
      if (box) {
        setText("f-jb-advice", adv);
        box.hidden = !adv;
      }
    }
    if (it.kind === "hub") {
      const w = wanOf(it);
      setVal("f-wan", w.type);
      setVal("f-speed", w.speed);
      const r = hubRouter();
      setVal("f-router", r ? r.id : "");
      setHtml("f-hub-advice", esc(hubAdvice(it)));
    }
    return;
  }
  setText("f-chead", t(isCableRun(c!) ? "cond.cablehead" : "cond.head", { label: c!.label! }));
  setVal("f-kind", c!.kind);
  setVal("f-clabel", c!.label);
  condDucts(c!).forEach((d, di) => {
    setVal(`f-duct-pipe-${di}`, d.pipe);
    ductCables(d).forEach((x, i) => setVal(`f-cab-${di}-${i}`, x.n));
  });
  setHtml("f-cstats", condStatsHtml(c!));
}

const previewModel = (pv: { kind: string; key: string } | null) =>
  pv && (pv.kind === "cond" ? CONDUITS[pv.key] : (CATALOG[pv.kind] || {})[pv.key]);

// Everything worth knowing about the tapped catalog entry, without leaving the page:
// datasheet, when it fits and when it doesn't, image, and retailer.
function buildPreview(root: HTMLElement, pv: { kind: string; key: string }) {
  const m = previewModel(pv);
  if (!m) return;
  const w = whenOf(pv.kind, pv.key),
    ww = w ? tx(w) : null;
  const advice = ww
    ? `<dl class="spec advice">
      <dt>${esc(t("prev.yes"))}</dt><dd class="ok"><span class="mk">✓</span>${esc(ww.yes)}</dd>
      <dt>${esc(t("prev.no"))}</dt><dd class="warn"><span class="mk">!</span>${esc(ww.no)}</dd>
    </dl>`
    : "";
  if (pv.kind === "cond") {
    const cabs = condCables(m),
      perM = pipeRate(m) + cabs.reduce((a, x) => a + CABLES[x.type].m * x.n, 0);
    const fixed = cabs.reduce((a, x) => a + CABLES[x.type].fixed * x.n, 0);
    const pipeTxt = condPipes(m)
      .map((p) => `${p.n} × ${tx(PIPES[p.pipe].name)}`)
      .join(", ");
    root.appendChild(
      h(`<h2>${esc(t("prev.head", { name: tx(m.name) }))}</h2>
      <dl class="spec">
        <dt>${esc(t("prev.perm"))}</dt><dd>${perM.toFixed(2)} €/m</dd>
        <dt>${esc(t("spec.pipe"))}</dt><dd>${pipeTxt ? esc(pipeTxt) : "–"}</dd>
        <dt>${esc(t("spec.cable"))}</dt><dd>${cabs.length ? esc(cabs.map((x) => x.n + " × " + tx(CABLES[x.type].name)).join(", ")) : "–"}</dd>
        <dt>${esc(t("spec.fixed"))}</dt><dd>${fmt(fixed)}</dd>
      </dl>
      ${advice}
      <p class="note tip">${esc(t("prev.draw"))}</p>`),
    );
    return;
  }
  root.appendChild(
    h(`<h2>${esc(t("prev.head", { name: tx(m.name) }))}</h2>
    <dl class="spec"><dt>${esc(t("cost.pos"))}</dt><dd>${m.price} €</dd></dl>
    ${specList(pv.kind, m)}
    ${advice}
    <p class="note">${pv.kind === "jb" ? "<b>" + esc(tx(m.use)) + ".</b> " : ""}${esc(tx(m.note))}</p>
    ${productBox(pv.kind, pv.key, m)}
    <p class="note tip">${esc(t(pv.kind === "jb" && isDevice(pv.key) ? "prev.gear" : "prev.place"))}</p>`),
  );
}

// The header row carries the two actions that belong to the whole element.
// A button row used to sit at the bottom for this — far away from the name.
function headRow(dup: boolean, info?: boolean) {
  return `<div class="selhead">
    <h2 id="f-head"></h2>
    <div class="hacts">
      ${info ? `<button class="btn icon" id="f-info" title="${esc(t("info.title"))}" aria-label="${esc(t("info.title"))}">${INFO}</button>` : ""}
      ${dup ? `<button class="btn icon" id="f-dup" title="${esc(t("f.dup"))}" aria-label="${esc(t("f.dup"))}">${COPY}</button>` : ""}
      <button class="btn icon danger" id="f-del" title="${esc(t("f.del"))}" aria-label="${esc(t("f.del"))}">${TRASH}</button>
    </div>
  </div>`;
}

// What is a device for? Exactly one group per entry. Injector and extender also have
// a PoE budget — they belong under "power supply", so that question comes first.
const GEAR_GROUPS = ["poe", "sw", "feed", "acc"];

// Accessory is whatever draws no power at all (`powerIn: "none"`) — not whatever has no
// power supply: a PoE-fed switch is still a switch.
const gearGroup = (m: Junction) =>
  m.poePorts || m.extend ? "feed" : (m.poe || 0) > 0 ? "poe" : powerIn(m) === "none" ? "acc" : "sw";

// Housing: where it goes. IP54 and higher mounts outside, IP20 inside.
const HOUSE_GROUPS = ["dig", "out", "in"];

const houseGroup = (m: Junction) => (m.dig ? "dig" : /IP[4-9]/.test(m.ip || "") ? "out" : "in");

// Flat lists don't say what an entry is for — <optgroup> does.
// Empty groups drop out, every option belongs to exactly one.
function optGroups(
  groups: string[],
  keys: string[],
  groupOf: (k: string) => string,
  label: (g: string) => string,
  opt: (k: string) => string,
) {
  return groups
    .map((g) => {
      const ks = keys.filter((k) => groupOf(k) === g);
      return ks.length
        ? `<optgroup label="${esc(label(g))}">${ks.map(opt).join("")}</optgroup>`
        : "";
    })
    .join("");
}

const optText = (kind: string, key: string, m: Model) =>
  [tx(m.name), m.price != null ? m.price + " €" : "", optHint(kind, key)]
    .filter(Boolean)
    .join(" · ");

// "Add device": selection grouped by task, with ⓘ and plus alongside.
// No preview box — image, properties, and product link live in the ⓘ dialog,
// the short version in the hover card on the field.
// Stands on its own here because the mains connection should get the same row.
const gearAddHtml = (cat: Record<string, Junction>) =>
  `<div class="field"><label for="f-gear-new">${esc(t("jb.gear.add"))}</label>` +
  `<div class="addcab"><select id="f-gear-new">` +
  optGroups(
    GEAR_GROUPS,
    Object.keys(cat).filter(isDevice),
    (k: string) => gearGroup(cat[k]),
    (g: string) => t("cat.grp." + g),
    (k: string) => `<option value="${k}">${esc(optText("jb", k, cat[k]))}</option>`,
  ) +
  `</select>` +
  `<button class="btn icon" id="f-geari-new" title="${esc(t("info.title"))}" aria-label="${esc(t("info.title"))}">${INFO}</button>` +
  `<button class="btn add" id="f-gear-go" title="${esc(t("jb.gear.add"))}" aria-label="${esc(t("jb.gear.add"))}">${PLUS}</button></div></div>`;

// No more preview box in the panel — it pushed the rest of the page far down.
// The ⓘ next to it shows the datasheet of the currently selected entry in the dialog.
function wireGearAdd(add: (key: string) => void) {
  const pick = $("f-gear-new");
  if (!pick) return;
  $("f-gear-go").onclick = () => add(pick.value);
  $("f-geari-new").onclick = () => showProductInfo("jb", pick.value);
  hoverSel(pick, "jb");
}

// Unit price on the row: for multiple pieces "2 × 60 €", so the unit price
// stays visible and doesn't get mistaken for the total.
const gearRowPrice = (g: Gear) => (g.n > 1 ? g.n + " × " : "") + JUNCTIONS[g.model].price + " €";

// Device list for a point — and for the hub: quantity, datasheet, trash.
function buildGearRows(it: Item) {
  const box = $("f-gears"),
    gs = jbGear(it);
  if (!gs.length) {
    box.appendChild(h(`<div class="empty">${esc(t("jb.gear.none"))}</div>`).firstElementChild!);
    return;
  }
  gs.forEach((g, i) => {
    const gm = JUNCTIONS[g.model];
    const r = h(
      `<div class="cabrow withp" data-hover="jb:${esc(g.model)}"><span class="dot" style="background:var(--accent)"></span><span class="n">${esc(tx(gm.name))}</span><small class="p" id="f-gearp-${i}">${esc(gearRowPrice(g))}</small><input class="qty" type="number" min="1" max="12" id="f-gear-${i}" value="${g.n}"><button class="btn ico" id="f-geari-${i}" title="${esc(t("info.title"))}" aria-label="${esc(t("info.title"))}">${INFO}</button><button class="btn del" id="f-gearx-${i}" title="${esc(t("jb.gear.del"))}" aria-label="${esc(t("jb.gear.del"))}">${TRASH}</button></div>`,
    ).firstElementChild as HTMLElement;
    box.appendChild(r);
    r.querySelector<HTMLElement>("#f-gear-" + i)!.onchange = (e) => {
      g.n = Math.max(1, +(e.target as HTMLInputElement).value | 0);
      changed();
    };
    r.querySelector<HTMLElement>("#f-gearx-" + i)!.onclick = () => {
      it.gear!.splice(it.gear!.indexOf(g), 1);
      changed();
    };
    r.querySelector<HTMLElement>("#f-geari-" + i)!.onclick = () => showProductInfo("jb", g.model);
  });
}

// What's still missing at the hub — derived from router, devices, and conduits,
// not from the catalog. One sentence, not a paragraph.
function hubAdvice(it: Item) {
  const L = links(),
    g: { devices?: Item[] } = L.gear.get(it.id) || {},
    r = hubRouter();
  const fiber = (L.touch.get(it.id) || []).some((c: Conduit) =>
    condCables(c).some((x) => x.type === "fiber"),
  );
  if (!r) return t("hub.adv.norouter");
  if (fiber && !hubSfp(it)) return t("hub.adv.nosfp");
  if ((g.devices || []).length && hubPoe(it) === 0) return t("hub.adv.nopoe");
  // Fiber straight into the router: then each end has an SFP module, no device in between.
  if (fiber && r.sfp && !jbSfp(it)) return t("hub.adv.sfpdirect");
  const gn = gearNames(it);
  return t("hub.adv.ok", { what: gn ? `${tx(r.name)} + ${gn}` : tx(r.name) });
}

// At the fiber end there's often a media converter plus a switch without SFP. A single
// switch with an SFP slot does both — if it's not notably more expensive, it gets
// suggested here. Nothing gets changed: the sentence is a hint, not an action.
const SWAP_SLACK = 30; // € surcharge that one fewer device in the box is worth

function jbAdvice(it: Item) {
  const L = links();
  return fiberAdvice(it, L) || mainsAdvice(it, L);
}

// If a point has no power outlet, a PoE-fed device sometimes helps: it hangs off the
// same copper cable as the camera behind it — one less cable in the trench. It has to
// do the same things — SFP if fiber arrives there, and enough PoE for what's attached.
// Power-feed devices (injector, extender) don't replace a switch and stay excluded.
function mainsAdvice(it: Item, L: ReturnType<typeof links>) {
  const mn = jbMains(it);
  if (!mn || mainsAt(it, L.touch)) return "";
  const have = jbGear(it),
    sum = have.reduce((a, g) => a + JUNCTIONS[g.model].price * g.n, 0);
  const need = L.gear.get(it.id) || { watts: 0, used: 0 };
  const wantSfp = have.some((g) => JUNCTIONS[g.model].sfp),
    wantPoe = jbPoe(it) > 0;
  const best = Object.keys(JUNCTIONS)
    .filter((k) => {
      const m = JUNCTIONS[k];
      // Whatever already delivers PoE there must not be swapped for a switch without PoE —
      // even if no camera is attached to it right now.
      return (
        powerIn(m) === "poe" &&
        !m.poePorts &&
        !m.extend &&
        (!wantSfp || m.sfp) &&
        (!wantPoe || (m.poe || 0) > 0) &&
        (m.poe || 0) >= need.watts &&
        (m.ports || 0) >= need.used
      );
    })
    .map((k) => JUNCTIONS[k])
    .sort((a, b) => a.price - b.price)[0];
  if (!best || best.price > sum + SWAP_SLACK) return "";
  return t("jb.adv.mains", {
    name: tx(best.name),
    price: best.price,
    poe: best.poe || 0,
    cur: gearNames(it),
    sum,
  });
}

function fiberAdvice(it: Item, L: ReturnType<typeof links>) {
  if (
    !(L.touch.get(it.id) || []).some((c: Conduit) => condCables(c).some((x) => x.type === "fiber"))
  )
    return "";
  const have = jbGear(it),
    sum = have.reduce((a, g) => a + JUNCTIONS[g.model].price * g.n, 0);
  // What counts is **one** device that can do both. Converter plus switch without SFP
  // together do satisfy sfp and poe, but that's exactly the case this is about.
  if (have.some((g) => JUNCTIONS[g.model].sfp && (JUNCTIONS[g.model].poe || 0) > 0)) return "";
  const need = L.gear.get(it.id) || { watts: 0, used: 0 };
  const best = Object.keys(JUNCTIONS)
    .filter((k) => {
      const m = JUNCTIONS[k];
      // poe > 0 isn't a technicality: a media converter satisfies ">= 0 W" and
      // would otherwise show up as a recommendation that "delivers 0 W PoE".
      return m.sfp && (m.poe || 0) > 0 && m.poe! >= need.watts && (m.ports || 0) >= need.used;
    })
    .map((k) => JUNCTIONS[k])
    .sort((a, b) => a.price - b.price)[0];
  if (!best || best.price > sum + SWAP_SLACK) return "";
  return t("jb.adv.swap", {
    name: tx(best.name),
    price: best.price,
    poe: best.poe || 0,
    cur: gearNames(it),
    sum,
  });
}

// One router per plan: the chosen one turns on, all others off. The quantity stays
// put, so an accidental switch doesn't discard it.
function pickRouter(id: string) {
  ROUTERS.forEach((r) => {
    const st = state.infra[r.id] || { on: false, qty: 1 };
    state.infra[r.id] = { on: r.id === id, qty: Math.max(1, st.qty || 1) };
  });
  changed();
}

function buildItemSel(root: HTMLElement, it: Item) {
  if (it.kind === "hub") {
    const w = wanOf(it);
    root.appendChild(
      h(`
      ${headRow(true, true)}
      <div class="field"><label for="f-label">${esc(t("f.label"))}</label><input type="text" id="f-label" value="${esc(it.label)}" maxlength="4"></div>
      <div class="field"><label for="f-note">${esc(t("f.desc"))}</label><input type="text" id="f-note" value="${esc(it.note || "")}" placeholder="${esc(t("f.desc.ph"))}"></div>
      <div class="field"><label for="f-wan">${esc(t("f.wan"))}</label><select id="f-wan">${Object.keys(
        WAN,
      )
        .map((k) => `<option value="${k}">${esc(tx(WAN[k].name))}</option>`)
        .join("")}</select></div>
      <div class="field"><label for="f-speed">${esc(t("f.speed"))}</label><select id="f-speed">${WAN[w.type].speeds.map((v) => `<option value="${v}">${v} Mbit/s</option>`).join("")}</select></div>
      <h3 class="subhead">${esc(t("hub.router"))}</h3>
      <div class="field"><label for="f-router">${esc(t("f.model"))}</label><div class="addcab"><select id="f-router"><option value="">${esc(t("hub.router.none"))}</option>${
        // Routers grouped by vendor: UniFi records, a FRITZ!Box doesn't.
        optGroups(
          [...new Set(ROUTERS.map(vendorOf))],
          ROUTERS.map((r) => r.id),
          (id: string) => vendorOf(catEntry("gear", id)),
          (v: string) => VENDORS[v] || v,
          (id: string) =>
            `<option value="${id}">${esc(optText("gear", id, catEntry("gear", id)))}</option>`,
        )
      }</select><button class="btn icon" id="f-routeri" title="${esc(t("info.title"))}" aria-label="${esc(t("info.title"))}">${INFO}</button></div></div>
      <h3 class="subhead">${esc(t("hub.gear"))}</h3>
      <div class="cabs" id="f-gears"></div>
      ${gearAddHtml(JUNCTIONS)}
      <p class="note tip" id="f-hub-advice"></p>
      <dl class="spec" id="f-link"></dl>
      <div class="row"><button class="btn" id="f-addr">${esc(t("f.addr"))}</button><button class="btn" id="f-parcel">${esc(t("f.parcel"))}</button></div>`),
    );
    buildGearRows(it);
    wireGearAdd((key) => addGear(it, key));
    $("f-info").onclick = () => showGuide("hub", t("cat.gear"));
    $("f-router").onchange = (e: { target: HTMLSelectElement }) => pickRouter(e.target.value);
    $("f-routeri").onclick = () => {
      const id = $("f-router").value;
      if (id) showProductInfo("gear", id);
    };
    hoverSel($("f-router"), "gear");
    $("f-parcel").onclick = async (ev: { target: HTMLButtonElement }) => {
      const btn = ev.target;
      btn.disabled = true;
      btn.textContent = t("f.addr.busy");
      try {
        const p2 = await parcelAt(it.x, it.y);
        const ort = [
          p2.gemarkung,
          p2.gemeinde && p2.gemeinde !== p2.gemarkung ? `(${p2.gemeinde})` : "",
        ]
          .filter(Boolean)
          .join(" ");
        if (p2.parcel) {
          state.sub = t("sub.parcel", { parcel: p2.parcel, flur: p2.flur, ort });
          applyName();
          scheduleSave();
        } else setStatus(t("f.parcel.none"));
      } catch {
        setStatus(t("f.parcel.none"));
      }
      btn.disabled = false;
      btn.textContent = t("f.parcel");
    };
    $("f-dup").onclick = () => duplicate(it);
    $("f-addr").onclick = async (e: { target: HTMLButtonElement }) => {
      const btn = e.target;
      btn.disabled = true;
      btn.textContent = t("f.addr.busy");
      try {
        const ll = pxLatLon(it.x, it.y);
        const addr = shortAddress(await geoReverse(ll.lat, ll.lon));
        if (addr) {
          it.note = addr;
          changed();
        } else setStatus(t("f.addr.none"));
      } catch {
        setStatus(t("f.addr.none"));
      }
      btn.disabled = false;
      btn.textContent = t("f.addr");
    };
    $("f-label").onchange = (e: { target: HTMLInputElement }) => {
      it.label = e.target.value.trim() || it.label;
      changed();
    };
    $("f-note").onchange = (e: { target: HTMLInputElement }) => {
      it.note = e.target.value;
      changed();
    };
    // Changing the type means different tiers — the highest matching one is the most sensible default.
    $("f-wan").onchange = (e: { target: HTMLSelectElement }) => {
      const sp = WAN[e.target.value].speeds;
      it.wan = { type: e.target.value as Wan["type"], speed: sp[sp.length - 1] };
      changed();
    };
    $("f-speed").onchange = (e: { target: HTMLSelectElement }) => {
      it.wan = { type: wanOf(it).type, speed: +e.target.value };
      changed();
    };
    $("f-del").onclick = deleteSelected;
    return;
  }
  const cat = CATALOG[it.kind],
    m = cat[it.model as string];
  // A junction only picks its housing here; the devices inside it live in their
  // own section below. The housing's datasheet sits behind the ⓘ
  // next to it — the panel holds only fields, lists, and the status.
  const jb = it.kind === "jb";
  const models = jb ? Object.keys(cat).filter(isHousing) : Object.keys(cat);
  const opt = (k: string) =>
    `<option value="${k}" ${k === it.model ? "selected" : ""}>${esc(optText(it.kind, k, cat[k]))}</option>`;
  // Housings grouped by location (buried, outdoor wall, indoor); cameras and
  // access points stay a single list — there's nothing to separate there.
  const pick = `<select id="f-model">${
    jb
      ? optGroups(
          HOUSE_GROUPS,
          models,
          (k: string) => houseGroup(cat[k]),
          (g: string) => t("cat.grp." + g),
          opt,
        )
      : models.map(opt).join("")
  }</select>`;
  root.appendChild(
    h(
      `
    ${headRow(true)}
    <div class="field"><label for="f-model">${esc(t(jb ? "f.housing" : "f.model"))}</label>` +
        `<div class="addcab">${pick}<button class="btn icon" id="f-modeli" title="${esc(t("info.title"))}" aria-label="${esc(t("info.title"))}">${INFO}</button></div></div>` +
        `
    ${it.kind === "cam" ? `<div class="field"><label for="f-rot">${esc(t("f.rot"))}</label><div><input type="range" id="f-rot" min="0" max="359" value="${it.rot}"><span class="val" id="f-rot-val"></span></div></div>` : ""}
    ${it.kind === "ap" ? `<div class="field"><label for="f-place">${esc(t("f.place"))}</label><select id="f-place">${["in", "out"].map((k) => `<option value="${k}" ${(it.place || (m.out ? "out" : "in")) === k ? "selected" : ""}>${esc(t("f.place." + k))}</option>`).join("")}</select></div>` : ""}
    ${it.kind === "ap" ? `<div class="field"><label for="f-rings">${esc(t("f.rings"))}</label><select id="f-rings">${["both", "far", "near", "none"].map((k) => `<option value="${k}" ${(it.rings || "both") === k ? "selected" : ""}>${esc(t("f.rings." + k))}</option>`).join("")}</select></div>` : ""}
    <div class="field"><label for="f-label">${esc(t("f.label"))}</label><input type="text" id="f-label" value="${esc(it.label)}" maxlength="4"></div>
    <div class="field"><label for="f-note">${esc(t("f.note"))}</label><input type="text" id="f-note" value="${esc(it.note || "")}" placeholder="${esc(t("f.note.ph"))}"></div>
    ${
      jb
        ? `<h3 class="subhead">${esc(t("jb.gear"))}</h3>
    <div class="cabs" id="f-gears"></div>
    ${gearAddHtml(cat)}
    <p class="note tip" id="f-jb-advice" hidden></p>`
        : ""
    }
    <dl class="spec" id="f-link"></dl>`,
    ),
  );

  if (jb) {
    buildGearRows(it);
    wireGearAdd((key) => addGear(it, key));
  }
  $("f-modeli").onclick = () => showProductInfo(it.kind, $("f-model").value);
  hoverSel($("f-model"), it.kind);
  $("f-model").onchange = (e: { target: HTMLSelectElement }) => {
    it.model = e.target.value;
    changed();
  };
  if (it.kind === "ap") {
    // Both selects only ever offer the values of their union.
    $("f-rings").onchange = (e: { target: HTMLSelectElement }) => {
      it.rings = e.target.value as Item["rings"];
      changed();
    };
    $("f-place").onchange = (e: { target: HTMLSelectElement }) => {
      it.place = e.target.value as Item["place"];
      changed();
    };
  }
  if (it.kind === "cam") {
    $("f-rot").oninput = (e: { target: HTMLInputElement }) => {
      it.rot = +e.target.value;
      setText("f-rot-val", t("f.rot.val", { n: it.rot }));
      refreshItem(it);
    };
    $("f-rot").onchange = () => changed();
  }
  $("f-dup").onclick = () => duplicate(it);
  $("f-label").onchange = (e: { target: HTMLInputElement }) => {
    it.label = e.target.value.trim() || it.label;
    changed();
  };
  $("f-note").onchange = (e: { target: HTMLInputElement }) => {
    it.note = e.target.value;
    changed();
  };
  $("f-del").onclick = deleteSelected;
}

// Hub and accessories have no position, otherwise they're normal catalog items:
// quantity instead of a label, deleting means "no longer planned".
function buildGearSel(root: HTMLElement, m: InfraItem) {
  root.appendChild(
    h(`
    ${headRow(false, true)}
    <div class="field"><label for="f-qty">${esc(t("f.qty"))}</label><input type="number" id="f-qty" min="1" max="99" value="1"></div>
    <dl class="spec">
      <dt>${esc(t("gear.unit"))}</dt><dd>${m.price} €</dd>
      <dt>${esc(t("gear.sum"))}</dt><dd id="f-gsum"></dd>
    </dl>`),
  );
  $("f-info").onclick = () => showProductInfo("gear", m.id);
  $("f-qty").onchange = (e: { target: HTMLInputElement }) => {
    state.infra[m.id] = { on: true, qty: Math.max(1, Math.min(99, +e.target.value | 0)) };
    changed();
  };
  $("f-del").onclick = deleteSelected;
}

// Duct and cable are two different things: a trench can carry several ducts, a duct
// several cables. Only this way can a trunk carrying two fibers be modeled.
function duplicate(it: Item) {
  const cp = {
    ...it,
    id: uid(),
    label: nextLabel(KIND_PREFIX[it.kind] || "E"),
    x: it.x + 20,
    y: it.y + 20,
  };
  if (Array.isArray(cp.gear)) cp.gear = cp.gear.map((g: Gear) => ({ ...g })); // otherwise both points would share one device list
  state.items.push(cp);
  select({ kind: "item", id: cp.id });
  changed();
}

// One block per duct: containing its type, its cables, and the add row. A cable run
// (`kind: "cable"`) has exactly one bundle without a duct — then the duct select,
// heading and "add duct" drop, leaving just the plain cable list.
function buildCondSel(root: HTMLElement, c: Conduit) {
  const solo = isCableRun(c);
  root.appendChild(
    h(`
    <div class="selhead"><h2 id="f-chead"></h2><div class="hacts"><button class="btn icon" id="f-cinfo" title="${esc(t("info.title"))}" aria-label="${esc(t("info.title"))}">${INFO}</button><button class="btn icon danger" id="f-cdel" title="${esc(t("f.del"))}" aria-label="${esc(t("f.del"))}">${TRASH}</button></div></div>
    <div class="field"><label for="f-kind">${esc(t("f.kind"))}</label><select id="f-kind"><option value="trench">${esc(t("f.kind.trench"))}</option><option value="cable">${esc(t("f.kind.cable"))}</option></select></div>
    <div id="f-ducts"></div>
    ${solo ? "" : `<div class="row"><button class="btn" id="f-duct-add">${esc(t("f.duct.add"))}</button></div>`}
    <div class="field"><label for="f-clabel">${esc(t("f.clabel"))}</label><input type="text" id="f-clabel" value="${esc(c.label)}"></div>
    <dl class="spec" id="f-cstats"></dl>
    <p class="note">${esc(t("hint.vtx"))}</p>
    <p class="note">${esc(t("cond.nosplit"))}</p>`),
  );

  const box = $("f-ducts");
  condDucts(c).forEach((duct, di) => {
    const used = new Set<string>(ductCables(duct).map((x) => x.type));
    const free = Object.keys(CABLES).filter((k) => !used.has(k));
    const head = solo ? esc(t("f.cabs")) : `${esc(t("f.duct.n", { n: di + 1 }))}`;
    const bin =
      solo || condDucts(c).length < 2
        ? ""
        : `<button class="btn ico" id="f-ductx-${di}" title="${esc(t("f.duct.del"))}" aria-label="${esc(t("f.duct.del"))}">${TRASH}</button>`;
    const blk = h(`<div class="duct">
      <h3 class="subhead ducthead">${head}${bin}</h3>
      ${
        solo
          ? ""
          : `<div class="field"><label for="f-duct-pipe-${di}">${esc(t("f.pipe"))}</label><select id="f-duct-pipe-${di}">${Object.keys(
              PIPES,
            )
              .map(
                (k) =>
                  `<option value="${k}">${esc(tx(PIPES[k].name))} · ${PIPES[k].m.toFixed(2)} €/m</option>`,
              )
              .join("")}</select></div>`
      }
      <div class="cabs" id="f-cabs-${di}"></div>
      ${free.length ? `<div class="field"><label for="f-cab-new-${di}">${esc(t("f.cab.add"))}</label><div class="addcab"><select id="f-cab-new-${di}">${free.map((k) => `<option value="${k}">${esc(optText("cable", k, CABLES[k]))}</option>`).join("")}</select><button class="btn icon" id="f-cabi-new-${di}" title="${esc(t("info.title"))}" aria-label="${esc(t("info.title"))}">${INFO}</button><button class="btn add" id="f-cab-go-${di}" title="${esc(t("f.cab.add"))}" aria-label="${esc(t("f.cab.add"))}">${PLUS}</button></div></div>` : ""}
    </div>`).firstElementChild as HTMLElement;
    box.appendChild(blk);
    // Each duct has its own type and therefore its own price.
    if (!solo)
      blk.querySelector<HTMLElement>("#f-duct-pipe-" + di)!.onchange = (e) =>
        condEdit(c, () => {
          const v = (e.target as HTMLSelectElement).value;
          duct.pipe = PIPES[v] ? (v as PipeType) : "dn50";
        });
    const cabs = blk.querySelector<HTMLElement>("#f-cabs-" + di)!;
    const list = ductCables(duct);
    if (!list.length)
      cabs.appendChild(
        h(`<div class="empty">${esc(t(solo ? "f.cabs.none.bare" : "f.cabs.none"))}</div>`)
          .firstElementChild!,
      );
    list.forEach((x, i) => {
      const d = CABLES[x.type];
      const r = h(
        `<div class="cabrow" data-hover="cable:${esc(x.type)}"><span class="dot" style="background:${d.color}"></span><span class="n">${esc(tx(d.name))}</span><input class="qty" type="number" min="1" max="12" id="f-cab-${di}-${i}" value="${x.n}"><button class="btn ico" id="f-cabi-${di}-${i}" title="${esc(t("info.title"))}" aria-label="${esc(t("info.title"))}">${INFO}</button><button class="btn del" id="f-cabx-${di}-${i}" title="${esc(t("f.cab.del"))}" aria-label="${esc(t("f.cab.del"))}">${TRASH}</button></div>`,
      ).firstElementChild as HTMLElement;
      cabs.appendChild(r);
      r.querySelector<HTMLElement>(`#f-cab-${di}-${i}`)!.onchange = (e) =>
        condEdit(c, () => {
          x.n = Math.max(1, +(e.target as HTMLInputElement).value | 0);
        });
      r.querySelector<HTMLElement>(`#f-cabx-${di}-${i}`)!.onclick = () =>
        condEdit(c, () => {
          duct.cables.splice(duct.cables.indexOf(x), 1);
        });
      r.querySelector<HTMLElement>(`#f-cabi-${di}-${i}`)!.onclick = () =>
        showProductInfo("cable", x.type);
    });
    if (free.length) {
      blk.querySelector<HTMLElement>("#f-cab-go-" + di)!.onclick = () =>
        condEdit(c, () => {
          duct.cables = duct.cables || [];
          duct.cables.push({ type: $("f-cab-new-" + di).value, n: 1 });
        });
      blk.querySelector<HTMLElement>("#f-cabi-new-" + di)!.onclick = () =>
        showProductInfo("cable", $("f-cab-new-" + di).value);
      hoverSel(blk.querySelector("#f-cab-new-" + di), "cable");
    }
    // Removing a duct takes its cables with it — nothing gets reassigned.
    if (bin)
      blk.querySelector<HTMLElement>("#f-ductx-" + di)!.onclick = () =>
        condEdit(c, () => {
          c.ducts.splice(di, 1);
        });
  });
  if (!solo)
    $("f-duct-add").onclick = () =>
      condEdit(c, () => {
        if (c.ducts.length < 6) c.ducts.push({ pipe: "dn50", cables: [] });
      });
  $("f-cinfo").onclick = () => showInfo(CAT_TABS.find((x) => x.id === "cond")!);
  // Switching type: to cable run collapses all cables into one bundle, back to trench
  // wraps a DN 50 duct around it. Both go through migrateConduit — the same rule
  // as on load, so a cable run never carries more than one duct.
  $("f-kind").onchange = (e: { target: HTMLSelectElement }) =>
    condEdit(c, () => {
      c.kind = e.target.value === "cable" ? "cable" : "trench";
      migrateConduit(c);
    });
  $("f-clabel").onchange = (e: { target: HTMLInputElement }) => {
    c.label = e.target.value;
    changed();
  };
  $("f-cdel").onclick = deleteSelected;
}
