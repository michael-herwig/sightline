// @ts-nocheck
// Cost panel and the bill of materials.
import { lang, t, tx } from "./i18n";
import { APS, CAMS, JUNCTIONS } from "./catalogs";
import { condCables, condName } from "./conduit";
import { planTitle, state } from "./store";
import { jbGearGroups, jbPower } from "./gear";
import { links } from "./links";
import { costs } from "./costs";
import { $, esc, fmt, fmtM, h, pane, setHtml, setText, setVal } from "./dom";
import { changed } from "./history";
import { fmtW } from "./panel-sel";

export function bomRows(c) {
  const rows = [];
  rows.push(
    `<tr><th>${esc(t("cost.pos"))}</th><th></th><th style="text-align:right">${esc(t("cost.amount"))}</th></tr>`,
  );
  const camGroups = {};
  c.cams.forEach((i) => {
    camGroups[i.model] = (camGroups[i.model] || 0) + 1;
  });
  for (const k in camGroups)
    rows.push(
      `<tr><td>${esc(CAMS[k].name)}</td><td class="num">${camGroups[k]} ×</td><td class="num">${fmt(CAMS[k].price * camGroups[k])}</td></tr>`,
    );
  const apGroups = {};
  c.aps.forEach((i) => {
    apGroups[i.model] = (apGroups[i.model] || 0) + 1;
  });
  for (const k in apGroups)
    rows.push(
      `<tr><td>${esc(APS[k].name)}</td><td class="num">${apGroups[k]} ×</td><td class="num">${fmt(APS[k].price * apGroups[k])}</td></tr>`,
    );
  // Housing and devices kept separate: devices bundled by model across all points.
  // "Indoor" costs nothing and isn't a purchase — so it never appears in a bill of materials.
  const jbGroups = {};
  c.jbs.forEach((i) => {
    if (JUNCTIONS[i.model].price) jbGroups[i.model] = (jbGroups[i.model] || 0) + 1;
  });
  for (const k in jbGroups)
    rows.push(
      `<tr><td>${esc(tx(JUNCTIONS[k].name))}</td><td class="num">${jbGroups[k]} ×</td><td class="num">${fmt(JUNCTIONS[k].price * jbGroups[k])}</td></tr>`,
    );
  const gearGroups = jbGearGroups(c.jbs.concat(c.hubs));
  for (const k in gearGroups)
    rows.push(
      `<tr><td>${esc(tx(JUNCTIONS[k].name))}</td><td class="num">${gearGroups[k]} ×</td><td class="num">${fmt(JUNCTIONS[k].price * gearGroups[k])}</td></tr>`,
    );
  c.conds.forEach((i) =>
    rows.push(
      `<tr><td>${esc(i.label)}<small>${esc(condName(i))}</small></td><td class="num">${fmtM(i.c.len)}</td><td class="num">${fmt(i.c.total)}</td></tr>`,
    ),
  );
  c.infra.forEach((i) =>
    rows.push(
      `<tr><td>${esc(tx(i.name))}</td><td class="num">${i.qty} ×</td><td class="num">${fmt(i.price * i.qty)}</td></tr>`,
    ),
  );
  rows.push(
    `<tr class="sum"><td>${esc(t("cost.sum.cams"))}</td><td></td><td class="num">${fmt(c.sumCams)}</td></tr>`,
  );
  rows.push(
    `<tr class="sum"><td>${esc(t("cost.sum.aps"))}</td><td></td><td class="num">${fmt(c.sumAps)}</td></tr>`,
  );
  rows.push(
    `<tr class="sum"><td>${esc(t("cost.sum.jbs"))}</td><td class="num">${c.jbs.length} ×</td><td class="num">${fmt(c.sumJbs)}</td></tr>`,
  );
  rows.push(
    `<tr class="sum"><td>${esc(t("cost.sum.cond"))}</td><td class="num">${fmtM(c.conds.reduce((a, b) => a + b.c.len, 0))}</td><td class="num">${fmt(c.sumCond)}</td></tr>`,
  );
  rows.push(
    `<tr class="sum"><td>${esc(t("cost.sum.infra"))}</td><td></td><td class="num">${fmt(c.sumInfra)}</td></tr>`,
  );
  rows.push(
    `<tr class="grand"><td>${esc(t("cost.total"))}</td><td></td><td class="num">${fmt(c.total)}</td></tr>`,
  );
  return { rows, camGroups, apGroups, jbGroups, gearGroups };
}

export function renderCost() {
  const c = costs();
  const over = c.total > state.budget;
  setText("totalChip", fmt(c.total));
  $("totalChip").className = "total-chip" + (over ? " over" : "");
  const p = pane("pane-cost", "cost:" + lang, (pn) => {
    pn.appendChild(
      h(`<h2>${esc(t("cost.budget"))}</h2>
      <div class="field"><label for="f-budget">${esc(t("cost.frame"))}</label><input type="number" id="f-budget" step="100" value="${state.budget}"></div>
      <div class="field"><label for="f-earth">${esc(t("cost.earth"))}</label><div><input type="number" id="f-earth" step="1" min="0" value="${state.earthwork || 0}"><span class="val">${esc(t("cost.earth.val"))}</span></div></div>
      <div class="budget"><div class="bar"><i id="c-bar"></i></div></div>
      <p class="note" id="c-left"></p>
      <div id="c-warn"></div>
      <h2>${esc(t("cost.bom"))}</h2><div style="overflow-x:auto"><table class="cost" id="c-bom"></table></div>
      <p class="note" style="margin-top:8px">${esc(t("cost.bom.note"))}</p>
      <div id="c-out"></div>`),
    );
    $("f-budget").onchange = (e) => {
      state.budget = Math.max(0, +e.target.value || 0);
      changed();
    };
    $("f-earth").onchange = (e) => {
      state.earthwork = Math.max(0, +e.target.value || 0);
      changed();
    };
  });
  if (!p) return;

  setVal("f-budget", state.budget);
  setVal("f-earth", state.earthwork || 0);
  const bar = $("c-bar");
  bar.className = over ? "over" : "";
  bar.style.width = Math.min(100, (c.total / Math.max(1, state.budget)) * 100) + "%";
  setText(
    "c-left",
    over
      ? t("cost.over", { v: fmt(c.total - state.budget) })
      : t("cost.left", { v: fmt(state.budget - c.total) }),
  );
  $("c-left").classList.toggle("over", over);

  const warn = [];
  const ucgOn = state.infra.ucg && state.infra.ucg.on,
    unvrOn = state.infra.unvr && state.infra.unvr.on;
  if (ucgOn && !unvrOn && c.n4k > 5)
    warn.push(`<div class="warnbox">${esc(t("cost.nvr.warn", { n: c.n4k }))}</div>`);
  else if (c.cams.length)
    warn.push(
      `<div class="okbox">${esc(t("cost.nvr.ok", { a: c.n4k, b: c.n2k, dev: unvrOn ? "UNVR" : "UCG-Fiber" }))}</div>`,
    );
  const wifiCams = c.cams.filter((i) => CAMS[i.model].wifi).length;
  if (wifiCams)
    warn.push(`<div class="warnbox">${esc(t("cost.wifi.warn", { n: wifiCams }))}</div>`);
  // Fiber needs a device at the other end that turns it back into copper.
  const fibreEnds = state.conduits.some((cd) => condCables(cd).some((x) => x.type === "fiber"));
  if (fibreEnds && !state.items.some(jbPower))
    warn.push(`<div class="warnbox">${esc(t("cost.fiber.warn"))}</div>`);
  // Derived findings: devices without a clean connection, switches over their PoE budget.
  const L = links();
  const bad = [...L.status.values()].filter((s) => s.g !== "ok").length;
  if (bad) warn.push(`<div class="warnbox">${esc(t("cost.link.warn", { n: bad }))}</div>`);
  for (const it of state.items) {
    const g = L.gear.get(it.id);
    if (g && g.over)
      warn.push(
        `<div class="warnbox">${esc(t("cost.poe.warn", { label: it.label, used: fmtW(g.watts), budget: g.poe }))}</div>`,
      );
  }
  setHtml("c-warn", warn.join(""));

  setHtml("c-bom", bomRows(c).rows.join(""));
}

export function copyBom(c) {
  const b = bomRows(c);
  const lines = [
    t("bom.title", {
      name: planTitle(),
      date: new Date().toLocaleDateString(lang === "de" ? "de-DE" : "en-GB"),
    }),
    "",
  ];
  for (const k in b.camGroups)
    lines.push(`${b.camGroups[k]} × ${CAMS[k].name}  ${fmt(CAMS[k].price * b.camGroups[k])}`);
  c.cams.forEach((i) => lines.push(`   ${i.label}  ${CAMS[i.model].name}  ${i.note || ""}`));
  for (const k in b.apGroups)
    lines.push(`${b.apGroups[k]} × ${APS[k].name}  ${fmt(APS[k].price * b.apGroups[k])}`);
  for (const k in b.jbGroups)
    lines.push(
      `${b.jbGroups[k]} × ${tx(JUNCTIONS[k].name)}  ${fmt(JUNCTIONS[k].price * b.jbGroups[k])}`,
    );
  for (const k in b.gearGroups)
    lines.push(
      `${b.gearGroups[k]} × ${tx(JUNCTIONS[k].name)}  ${fmt(JUNCTIONS[k].price * b.gearGroups[k])}`,
    );
  c.conds.forEach((i) =>
    lines.push(`${i.label}: ${condName(i)}, ${i.c.len.toFixed(0)} m  ${fmt(i.c.total)}`),
  );
  c.infra.forEach((i) => lines.push(`${i.qty} × ${tx(i.name)}  ${fmt(i.price * i.qty)}`));
  lines.push("", `${t("cost.total")}: ${fmt(c.total)} (${t("cost.frame")} ${fmt(state.budget)})`);
  const out = $("exp-out") || $("c-out");
  if (!out) return;
  out.innerHTML = "";
  const text = lines.join("\n");
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.className = "bom";
    ta.value = text;
    out.appendChild(ta);
    ta.select();
  };
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(fallback);
  else fallback();
}
