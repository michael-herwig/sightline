// @ts-nocheck
// PNG, PDF, print sheet and Markdown export.
import { lang, t, tx } from "./i18n";
import { PX_PER_M, bboxOf } from "./geo";
import {
  APS,
  CAMS,
  JUNCTIONS,
  VENDORS,
  WAN,
  amazonLabel,
  productUrl,
  vendorOf,
  wanOf,
} from "./catalogs";
import { condName } from "./conduit";
import { planFile, planSub, planTitle, state, view } from "./store";
import { gearNames, hubRouter, jbGearGroups, jbPower } from "./gear";
import { linkText, links } from "./links";
import { conduitCost, costs } from "./costs";
import { $, NS, closeDlg, esc, fmt, fmtM, setStatus, svg } from "./dom";
import { contentBox, svgW } from "./view";
import { ALKIS_LINES, BASEMAPS, wms } from "./tiles";
import { fmtW } from "./panel-sel";
import { exportPlan } from "./share";
import { bomRows, copyBom } from "./panel-cost";

// ---------- PDF: print sheet from map and bill of materials ----------
// No PDF generator as a dependency — the browser's print dialog makes the PDF.
// Tile stack out, one full image in for the box. hrefs: null = WMS address
// directly (print), otherwise a map url→data: (image export, because an SVG used as <img>
// isn't allowed to load anything externally).
function sheetBackdrop(clone, box, wpx, overlay, hrefs) {
  const bm = BASEMAPS[state.basemap] || BASEMAPS.dop;
  const hpx = Math.round((wpx * box.h) / box.w),
    bbox = bboxOf(box.x, box.y, box.w, box.h);
  const put = (layers, service, transparent, gid) => {
    const g = clone.querySelector("#" + gid);
    if (!g) return;
    g.innerHTML = "";
    const url = wms(service, layers, bbox, wpx, hpx, transparent);
    const img = document.createElementNS(NS, "image");
    img.setAttribute("x", box.x);
    img.setAttribute("y", box.y);
    img.setAttribute("width", box.w);
    img.setAttribute("height", box.h);
    img.setAttribute("preserveAspectRatio", "none");
    img.setAttribute("class", "ok instant"); // otherwise the fade-in rule (#g-tiles image { opacity: 0 }) keeps the image invisible
    img.setAttribute("href", hrefs ? hrefs.get(url) || "" : url);
    g.appendChild(img);
  };
  put(bm.layers, bm.service, false, "g-tiles");
  const go = clone.querySelector("#g-overlay");
  if (go) {
    go.innerHTML = "";
    go.style.display = "";
  }
  if (overlay && state.basemap !== "alkis") put(ALKIS_LINES, "wms_nw_alkis", true, "g-overlay");
}

const blobToDataUrl = (b) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(b);
  });

// PNG of the viewport: draw an SVG clone with page styles and embedded images via
// <img> onto a canvas. Resolution: double the screen width.
// Viewport as shown, or the whole plan in the screen's aspect ratio.
function exportBox(area) {
  let box = { ...view };
  if (area === "all") {
    const cb = contentBox();
    if (cb) {
      const ar = view.h / view.w,
        w = Math.max(cb.w, cb.h / ar);
      box = { x: cb.x + cb.w / 2 - w / 2, y: cb.y + cb.h / 2 - (w * ar) / 2, w, h: w * ar };
    }
  }
  return box;
}

async function renderPng(overlay, area, mime, quality) {
  const box = exportBox(area);
  const wpx = Math.min(4096, svg.clientWidth * 2),
    hpx = Math.round((wpx * box.h) / box.w);
  const bm = BASEMAPS[state.basemap] || BASEMAPS.dop,
    bbox = bboxOf(box.x, box.y, box.w, box.h);
  const urls = [wms(bm.service, bm.layers, bbox, wpx, hpx, false)];
  if (overlay && state.basemap !== "alkis")
    urls.push(wms("wms_nw_alkis", ALKIS_LINES, bbox, wpx, hpx, true));
  const hrefs = new Map();
  await Promise.all(
    urls.map(async (u) => {
      try {
        hrefs.set(u, await blobToDataUrl(await (await fetch(u, { mode: "cors" })).blob()));
      } catch {}
    }),
  );
  const clone = svg.cloneNode(true);
  clone.removeAttribute("id");
  clone.setAttribute("xmlns", NS);
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("viewBox", `${box.x} ${box.y} ${box.w} ${box.h}`);
  clone.setAttribute("width", wpx);
  clone.setAttribute("height", hpx);
  clone.classList.add("map");
  sheetBackdrop(clone, box, wpx, overlay, hrefs);
  // Strokes with non-scaling-stroke are measured in image pixels. The image is rendered
  // twice as large as the map — without this factor the conduits would come out half as thick.
  clone.style.setProperty("--sw", String(+(((view.w / svgW()) * wpx) / box.w).toFixed(3)));
  // The look controls (--look-*) sit as inline style on the SVG and come along with
  // cloneNode(true): whatever the map shows, the export shows.
  clone.querySelectorAll("#g-handles, .rothandle, .rothit").forEach((e) => e.remove());
  const css = [...document.querySelectorAll("style")].map((e) => e.textContent).join("\n");
  const st = document.createElementNS(NS, "style");
  st.textContent = css;
  clone.insertBefore(st, clone.firstChild);
  const src = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }),
  );
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = src;
    });
    const cv = document.createElement("canvas");
    cv.width = wpx;
    cv.height = hpx;
    const cx = cv.getContext("2d");
    cx.fillStyle = "#d8d5cc";
    cx.fillRect(0, 0, wpx, hpx);
    cx.drawImage(img, 0, 0, wpx, hpx);
    return await new Promise((res, rej) =>
      cv.toBlob((b) => (b ? res(b) : rej(new Error("png"))), mime || "image/png", quality),
    );
  } finally {
    URL.revokeObjectURL(src);
  }
}

async function exportPng(copy) {
  const overlay = !!state.overlay; // layers are already chosen on the map, not selected again here
  setStatus(t("exp.busy"));
  let blob;
  try {
    blob = await renderPng(overlay, expArea);
  } catch {
    setStatus(t("exp.fail"));
    return;
  }
  if (copy && navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setStatus(t("exp.copied"));
      return;
    } catch {
      /* fall back to a file, then */
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = planFile().replace(/\.json$/i, "") + ".png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setStatus(t(copy ? "exp.saved.instead" : "exp.saved"));
}

let expArea = "view";

const printOpts = () => ({
  bom: $("exp-p-bom").checked,
  price: $("exp-p-price").checked,
  items: $("exp-p-items").checked,
  links: $("exp-p-links").checked,
  area: expArea,
});

// The plan as Markdown: everything an AI needs to weigh in — position in meters
// relative to the house, models with data, conduits with length and contents, costs, open items.
function planMarkdown() {
  const c = costs(),
    de = lang === "de",
    L = [];
  const hub = state.items.find((i) => i.kind === "hub");
  const o = hub ? { x: hub.x, y: hub.y } : { x: view.x + view.w / 2, y: view.y + view.h / 2 };
  const m = (v) => (v / PX_PER_M).toFixed(1);
  const rel = (it) =>
    `${m(it.x - o.x)} m ${de ? "Ost" : "east"} / ${m(o.y - it.y)} m ${de ? "Nord" : "north"}`;
  const byId = Object.fromEntries(state.items.map((i) => [i.id, i]));
  const at = (p) => (p.at && byId[p.at] ? byId[p.at].label : `(${m(p.x - o.x)}, ${m(o.y - p.y)})`);
  L.push(`# ${planTitle()}`, "");
  L.push(
    de
      ? `Kamera-, WLAN- und Leerrohrplan, erstellt mit dem Leerrohr- und Kameraplaner. Stand ${new Date().toLocaleDateString("de-DE")}.`
      : `Camera, Wi-Fi and conduit plan, made with the conduit and camera planner. As of ${new Date().toLocaleDateString("en-GB")}.`,
  );
  if (state.sub) L.push(state.sub);
  L.push(
    "",
    de
      ? "Koordinaten: Meter relativ zum Hausanschluss (Ost / Nord). Nachtsicht und Reichweiten sind Herstellerangaben."
      : "Coordinates: metres relative to the house connection (east / north). Night ranges and radii are manufacturer figures.",
    "",
  );
  if (hub) {
    const w = wanOf(hub);
    const rt = hubRouter();
    L.push(
      `## ${de ? "Hausanschluss" : "House connection"}`,
      "",
      `- **${hub.label}** ${hub.note ? "– " + hub.note : ""}: ${tx(WAN[w.type].name)} ${w.speed} Mbit/s`,
    );
    L.push(`- Router: ${rt ? tx(rt.name) : de ? "keiner" : "none"}`);
    L.push(
      `- ${de ? "Geräte in der Zentrale" : "Gear in the head end"}: ${gearNames(hub) || (de ? "keine" : "none")}`,
      "",
    );
  }
  const cams = state.items.filter((i) => i.kind === "cam");
  if (cams.length) {
    L.push(`## ${de ? "Kameras" : "Cameras"} (${cams.length})`, "");
    L.push(
      de
        ? "| Nr | Modell | Position | Blick | Sichtfeld | IR | Auflösung | Strom | Notiz |"
        : "| No | Model | Position | Heading | FoV | IR | Resolution | Power | Note |",
    );
    L.push("|---|---|---|---|---|---|---|---|---|");
    cams.forEach((i) => {
      const md = CAMS[i.model];
      L.push(
        `| ${i.label} | ${md.name} (${VENDORS[vendorOf(md)]}) | ${rel(i)} | ${Math.round(i.rot || 0)}° | ${md.fov >= 360 ? "PTZ" : md.fov + "°"} | ${md.ir} m | ${md.res} | ${tx(md.poe)} | ${i.note || ""} |`,
      );
    });
    L.push("");
  }
  const aps = state.items.filter((i) => i.kind === "ap");
  if (aps.length) {
    L.push(`## Access Points (${aps.length})`, "");
    L.push(
      de
        ? "| Nr | Modell | Position | WLAN | Reichweite | Außen | Notiz |"
        : "| No | Model | Position | Wi-Fi | Range | Outdoor | Note |",
    );
    L.push("|---|---|---|---|---|---|---|");
    aps.forEach((i) => {
      const md = APS[i.model];
      L.push(
        `| ${i.label} | ${md.name} (${VENDORS[vendorOf(md)]}) | ${rel(i)} | ${md.wifi} | ~${md.radius} m | ${md.out ? (de ? "ja" : "yes") : de ? "nein" : "no"} | ${i.note || ""} |`,
      );
    });
    L.push("");
  }
  const jbs = state.items.filter((i) => i.kind === "jb");
  if (jbs.length) {
    L.push(`## ${de ? "Abzweige und Technik" : "Junctions and gear"} (${jbs.length})`, "");
    L.push(
      de
        ? "| Nr | Gehäuse | Position | Geräte darin | Strom | Zweck | Notiz |"
        : "| No | Housing | Position | Gear inside | Power | Purpose | Note |",
    );
    L.push("|---|---|---|---|---|---|---|");
    jbs.forEach((i) => {
      const md = JUNCTIONS[i.model];
      L.push(
        `| ${i.label} | ${tx(md.name)} | ${rel(i)} | ${gearNames(i) || (de ? "keine" : "none")} | ${jbPower(i) ? (de ? "ja" : "yes") : de ? "nein" : "no"} | ${tx(md.use)} | ${i.note || ""} |`,
      );
    });
    L.push("");
  }
  if (state.conduits.length) {
    L.push(`## ${de ? "Kanäle" : "Conduits"} (${state.conduits.length})`, "");
    L.push(
      de
        ? "| Nr | Von | Nach | Länge | Rohr und Kabel | Kosten |"
        : "| No | From | To | Length | Pipe and cables | Cost |",
    );
    L.push("|---|---|---|---|---|---|");
    state.conduits.forEach((cd) => {
      const cc = conduitCost(cd),
        pts = cd.points;
      L.push(
        `| ${cd.label || ""} | ${at(pts[0])} | ${at(pts[pts.length - 1])} | ${cc.len.toFixed(0)} m | ${condName(cd)} | ${fmt(cc.total)} |`,
      );
    });
    L.push(
      "",
      de
        ? "Glasfaser wird am Abzweig nicht geteilt; am Faserende steht ein Switch oder Medienkonverter."
        : "Fibre is not split at a branch; a switch or media converter sits at the far end.",
      "",
    );
  }
  if (c.infra.length) {
    L.push(`## ${de ? "Zentrale und Zubehör" : "Core and accessories"}`, "");
    c.infra.forEach((i) => L.push(`- ${i.qty} × ${tx(i.name)} — ${fmt(i.price * i.qty)}`));
    L.push("");
  }
  // Connections: derived from conduits and bonds, none of it is stored.
  const LK = links();
  if (LK.status.size || LK.gear.size) {
    L.push(`## ${de ? "Anschlüsse" : "Connections"}`, "");
    L.push(de ? "| Nr | Befund |" : "| No | Finding |", "|---|---|");
    for (const it of state.items) {
      const st = LK.status.get(it.id);
      if (!st) continue;
      L.push(`| ${it.label} | ${st.g === "ok" ? "" : "⚠ "}${linkText(st)} |`);
    }
    L.push("");
    for (const it of state.items) {
      const g = LK.gear.get(it.id);
      if (!g) continue;
      const names = g.devices.length
        ? g.devices.map((d) => d.label).join(", ")
        : de
          ? "keine"
          : "none";
      const budget = `${fmtW(g.watts)} / ${g.poe} W${g.over ? (de ? " — Budget überschritten" : " — over budget") : ""}`;
      L.push(`- **${it.label}**: ${names} · ${budget}`);
    }
    L.push("");
  }
  // Product links come from sheetData() — print, PDF, and Markdown all cite the same ones.
  const plinks = sheetData().plinks;
  if (plinks.size) {
    L.push(`## ${de ? "Produktlinks" : "Product links"}`, "");
    plinks.forEach((p, u) =>
      L.push(`- ${p.name}: ${u}` + (p.amazon ? ` · ${p.amazonLabel}: ${p.amazon}` : "")),
    );
    L.push("");
  }
  L.push(`## ${de ? "Kosten" : "Costs"}`, "");
  L.push(`| | |`, `|---|---|`);
  L.push(
    `| ${de ? "Kameras" : "Cameras"} | ${fmt(c.sumCams)} |`,
    `| Access Points | ${fmt(c.sumAps)} |`,
    `| ${de ? "Abzweige/Technik" : "Junctions/gear"} | ${fmt(c.sumJbs)} |`,
    `| ${de ? "Kanäle und Kabel" : "Conduits and cables"} | ${fmt(c.sumCond)} |`,
    `| ${de ? "Zentrale" : "Core"} | ${fmt(c.sumInfra)} |`,
    `| **${de ? "Summe" : "Total"}** | **${fmt(c.total)}** |`,
    `| ${de ? "Budget" : "Budget"} | ${fmt(state.budget)} |`,
  );
  L.push(
    "",
    de
      ? `Tiefbau: ${state.earthwork ? state.earthwork + " €/m" : "Eigenleistung (0 €/m)"}. Preise Stand 09/2026, keine Angebote.`
      : `Earthwork: ${state.earthwork ? state.earthwork + " €/m" : "own labour (0 €/m)"}. Prices as of 09/2026, not quotations.`,
    "",
  );
  L.push(`## ${de ? "Bitte prüfen" : "Please review"}`, "");
  L.push(
    de
      ? "- Sind Sichtfelder und Nachtsicht für die Zugänge ausreichend? Gibt es Lücken oder Doppelungen?"
      : "- Are fields of view and night ranges sufficient for the accesses? Any gaps or duplicates?",
  );
  L.push(
    de
      ? "- Passen Kanalführung, Rohrdurchmesser und Kabelzahl? Fehlt am Faserende ein Switch?"
      : "- Do the conduit routing, pipe size and cable count make sense? Is a switch missing at a fibre end?",
  );
  L.push(
    de
      ? "- Reicht das PoE-Budget je Switch für die angehängten Kameras und APs?"
      : "- Does the PoE budget per switch cover the attached cameras and APs?",
  );
  for (const it of state.items) {
    const st = LK.status.get(it.id);
    if (st && st.g !== "ok") L.push(`- ${it.label}: ${linkText(st)}`);
  }
  for (const it of state.items) {
    const g = LK.gear.get(it.id);
    if (g && g.over)
      L.push(`- ${t("cost.poe.warn", { label: it.label, used: fmtW(g.watts), budget: g.poe })}`);
  }
  return L.join("\n");
}

// What belongs on the sheet — same data for print and PDF.
function sheetData() {
  const c = costs(),
    items = [],
    bom = [],
    plinks = new Map(),
    LK = links();
  const add = (lab, name, sub) => items.push({ lab, name, sub: sub || "" });
  // The connection belongs on the sheet: either where the cable comes from or what's missing.
  const via = (id) => {
    const st = LK.status.get(id),
      r = LK.src.get(id);
    if (st && st.g !== "ok") return "⚠ " + linkText(st);
    return r ? t("sheet.via", { src: r.src.label, len: r.len.toFixed(0) }) : "";
  };
  c.cams.forEach((i) => {
    const m = CAMS[i.model];
    add(
      i.label,
      m.name,
      [i.note, `${m.fov >= 360 ? "PTZ" : m.fov + "°"} · IR ${m.ir} m · ${tx(m.poe)}`, via(i.id)]
        .filter(Boolean)
        .join(" · "),
    );
  });
  c.aps.forEach((i) => {
    const m = APS[i.model];
    add(i.label, m.name, [i.note, m.wifi, via(i.id)].filter(Boolean).join(" · "));
  });
  c.hubs.forEach((i) => {
    const rt = hubRouter();
    add(
      i.label,
      `${t("hub.router")}: ${rt ? tx(rt.name) : t("hub.router.none")}`,
      [i.note, gearNames(i), via(i.id)].filter(Boolean).join(" · "),
    );
  });
  c.jbs.forEach((i) => {
    const m = JUNCTIONS[i.model];
    add(
      i.label,
      tx(m.name),
      [i.note, gearNames(i) || tx(m.use), via(i.id)].filter(Boolean).join(" · "),
    );
  });
  c.conds.forEach((i) => add(i.label, condName(i), fmtM(i.c.len)));
  // A line item for €0 isn't a purchase — it doesn't belong on any sheet.
  const grp = (arr, cat) => {
    const g = {};
    arr.forEach((i) => {
      g[i.model] = (g[i.model] || 0) + 1;
    });
    for (const k in g)
      if (cat[k].price)
        bom.push({ name: tx(cat[k].name), qty: g[k] + " ×", amount: cat[k].price * g[k] });
  };
  grp(c.cams, CAMS);
  grp(c.aps, APS);
  grp(c.jbs, JUNCTIONS);
  const gg = jbGearGroups(c.jbs.concat(c.hubs));
  for (const k in gg)
    bom.push({
      name: tx(JUNCTIONS[k].name),
      qty: gg[k] + " ×",
      amount: JUNCTIONS[k].price * gg[k],
    });
  c.conds.forEach((i) =>
    bom.push({ name: `${i.label} — ${condName(i)}`, qty: fmtM(i.c.len), amount: i.c.total }),
  );
  c.infra.forEach((i) =>
    bom.push({ name: tx(i.name), qty: i.qty + " ×", amount: i.price * i.qty }),
  );
  const sums = [
    [t("cost.sum.cams"), c.sumCams],
    [t("cost.sum.aps"), c.sumAps],
    [t("cost.sum.jbs"), c.sumJbs],
    [t("cost.sum.cond"), c.sumCond],
    [t("cost.sum.infra"), c.sumInfra],
  ];
  // Product links: manufacturer page, plus — where verified — the Amazon listing.
  // The key stays the manufacturer URL, so nothing ends up duplicated on the sheet.
  [
    ...c.cams.map((i) => CAMS[i.model]),
    ...c.aps.map((i) => APS[i.model]),
    ...c.jbs.map((i) => JUNCTIONS[i.model]),
    ...Object.keys(gg).map((k) => JUNCTIONS[k]),
    ...c.infra,
  ].forEach((m) => {
    const u = productUrl(m);
    if (u && !plinks.has(u))
      plinks.set(u, {
        name: tx(m.name),
        amazon: m.amazon || "",
        amazonLabel: m.amazon ? amazonLabel(m) : "",
      });
  });
  return { c, items, bom, sums, plinks };
}

// PDF straight from the browser: jsPDF, loaded on demand — 400 kB that nobody
// who only plans ever needs. Map as PNG at double resolution,
// tables laid out by hand — a table plugin would be the next dependency.
async function exportPdf(o) {
  setStatus(t("exp.busy"));
  let jsPDF;
  try {
    ({ jsPDF } = await import("jspdf"));
  } catch {
    setStatus(t("exp.fail"));
    return;
  }
  const { c, items, bom, sums, plinks } = sheetData();
  let png = null;
  // JPEG instead of PNG: aerial imagery compresses to a tenth the size, keeping the PDF under half a MB.
  try {
    png = await blobToDataUrl(await renderPng(!!state.overlay, o.area, "image/jpeg", 0.85));
  } catch {}
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const M = 12,
    PW = 210 - 2 * M,
    PH = 297 - M;
  let y = M;
  const need = (h) => {
    if (y + h > PH) {
      doc.addPage();
      y = M;
    }
  };
  const line = (txt, size, style, color, x, w) => {
    doc.setFontSize(size);
    doc.setFont("helvetica", style || "normal");
    doc.setTextColor(color || 0);
    const rows = doc.splitTextToSize(String(txt), w || PW);
    need(rows.length * size * 0.42 + 1);
    doc.text(rows, x || M, y);
    y += rows.length * size * 0.42;
  };
  const h2 = (txt) => {
    y += 4;
    line(txt, 12, "bold");
    y += 1.5;
  };
  line(planTitle(), 16, "bold");
  line(
    [
      planSub(),
      new Date().toLocaleDateString(lang === "de" ? "de-DE" : "en-GB"),
      o.price ? `${t("cost.total")} ${fmt(c.total)}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    9,
    "normal",
    90,
  );
  y += 3;
  if (png) {
    const box = exportBox(o.area),
      ratio = box.h / box.w;
    let w = PW,
      h = w * ratio;
    if (h > 150) {
      h = 150;
      w = h / ratio;
    }
    need(h + 2);
    doc.addImage(png, "JPEG", M + (PW - w) / 2, y, w, h);
    doc.setDrawColor(150);
    doc.rect(M + (PW - w) / 2, y, w, h);
    y += h + 2;
  }
  const row = (cols, widths, size, style, rule) => {
    doc.setFontSize(size);
    doc.setFont("helvetica", style || "normal");
    doc.setTextColor(0);
    const cells = cols.map((c2, i) =>
      doc.splitTextToSize(String(c2 == null ? "" : c2), widths[i] - 2),
    );
    const h = Math.max(...cells.map((x) => x.length)) * size * 0.42 + 2.2;
    need(h);
    let x = M;
    cells.forEach((cell, i) => {
      const right = i === cols.length - 1 && cols.length > 2;
      doc.text(
        cell,
        right ? x + widths[i] - 1 : x,
        y + size * 0.35,
        right ? { align: "right" } : undefined,
      );
      x += widths[i];
    });
    y += h;
    if (rule) {
      doc.setDrawColor(rule === 2 ? 0 : 200);
      doc.setLineWidth(rule === 2 ? 0.4 : 0.15);
      doc.line(M, y - 1.2, M + PW, y - 1.2);
    }
  };
  if (o.items && items.length) {
    h2(t("tab.list"));
    items.forEach((it) =>
      row([it.lab, it.sub ? `${it.name}\n${it.sub}` : it.name], [16, PW - 16], 9, "normal", 1),
    );
  }
  if (o.bom) {
    h2(t("cost.bom"));
    const W3 = o.price ? [PW - 60, 30, 30] : [PW - 30, 30];
    row(o.price ? [t("cost.pos"), "", t("cost.amount")] : [t("cost.pos"), ""], W3, 8, "bold", 1);
    bom.forEach((b) =>
      row(o.price ? [b.name, b.qty, fmt(b.amount)] : [b.name, b.qty], W3, 9, "normal", 1),
    );
    if (o.price) {
      sums.forEach(([n, v]) => row([n, "", fmt(v)], W3, 9, "bold", 1));
      row([t("cost.total"), "", fmt(c.total)], W3, 11, "bold", 2);
    }
    line(t("cost.bom.note"), 8, "normal", 110);
  }
  if (o.links && plinks.size) {
    h2(t("exp.p.links"));
    plinks.forEach((p, u) => {
      line(`${p.name}: ${u}`, 8, "normal", 60);
      if (p.amazon) line(`${p.name} — ${p.amazonLabel}: ${p.amazon}`, 8, "normal", 60);
    });
  }
  doc.save(planFile().replace(/\.json$/i, "") + ".pdf");
  setStatus(t("exp.pdf.saved"));
}

function printSheet(o) {
  o = o || { bom: true, price: true, items: true, links: false, area: "view" };
  const c = costs(),
    b = bomRows(c);
  const box = exportBox(o.area);
  // Element list and product links come from sheetData() — print and PDF show the same thing.
  const sd = sheetData(),
    plinks = sd.plinks;
  const itemRows = sd.items.map(
    (it) =>
      `<tr><td>${esc(it.lab)}</td><td>${esc(it.name)}${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</td></tr>`,
  );
  const bomHtml = o.price
    ? b.rows.join("")
    : b.rows
        .map((r) =>
          r
            .replace(/<td class="num">[^<]*€<\/td>/g, "")
            .replace(/<th style="text-align:right">[^<]*<\/th>/, ""),
        )
        .join("");
  const clone = svg.cloneNode(true);
  clone.removeAttribute("id");
  clone.setAttribute("viewBox", `${box.x} ${box.y} ${box.w} ${box.h}`);
  clone.setAttribute("width", "100%");
  clone.setAttribute("height", "auto");
  // On paper the whole property belongs in one piece, not the tile stack
  // of the current viewport. So: tiles out, one full image in.
  sheetBackdrop(clone, box, 1600, state.overlay, null);
  const old = $("printsheet");
  if (old) old.remove();
  const sheet = document.createElement("div");
  sheet.id = "printsheet";
  sheet.innerHTML = `<h1>${esc(planTitle())}</h1>
    <p class="meta">${esc(planSub())} · ${esc(new Date().toLocaleDateString(lang === "de" ? "de-DE" : "en-GB"))}${o.price ? ` · ${esc(t("cost.total"))} ${fmt(c.total)}` : ""}</p>
    <div class="sheetmap"></div>
    ${o.items ? `<h2>${esc(t("tab.list"))}</h2><table class="cost">${itemRows.join("")}</table>` : ""}
    ${o.bom ? `<h2>${esc(t("cost.bom"))}</h2><table class="cost">${bomHtml}</table><p class="meta">${esc(t("cost.bom.note"))}</p>` : ""}
    ${
      o.links && plinks.size
        ? `<h2>${esc(t("exp.p.links"))}</h2><ul class="links">${[...plinks]
            .map(
              ([u, p]) =>
                `<li>${esc(p.name)}: ${esc(u)}${p.amazon ? `<br>${esc(p.amazonLabel)}: ${esc(p.amazon)}` : ""}</li>`,
            )
            .join("")}</ul>`
        : ""
    }`;
  sheet.querySelector(".sheetmap").appendChild(clone);
  document.body.appendChild(sheet);
  const cleanup = () => {
    sheet.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}

export function wireExport() {
  $("exp-area")
    .querySelectorAll("[data-area]")
    .forEach((b) => {
      b.onclick = () => {
        expArea = b.dataset.area;
        $("exp-area")
          .querySelectorAll("[data-area]")
          .forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      };
    });

  $("t-export").onclick = () => {
    try {
      $("expDlg").showModal();
    } catch {
      $("expDlg").open = true;
    }
  };

  $("expClose").onclick = () => closeDlg($("expDlg"));

  $("exp-copy").onclick = () => exportPng(true);

  $("exp-dl").onclick = () => exportPng(false);

  $("exp-pdf").onclick = () => {
    const o = printOpts();
    closeDlg($("expDlg"));
    printSheet(o);
  };

  $("exp-pdfdl").onclick = () => exportPdf(printOpts());

  $("exp-bom").onclick = () => {
    copyBom(costs());
    setStatus(t("exp.bom.copied"));
  };

  $("exp-json").onclick = () => {
    exportPlan();
    closeDlg($("expDlg"));
  };

  $("exp-md").onclick = async () => {
    const md = planMarkdown();
    const out = $("exp-out");
    out.innerHTML = "";
    try {
      await navigator.clipboard.writeText(md);
      setStatus(t("exp.md.copied"));
    } catch {
      const ta = document.createElement("textarea");
      ta.className = "bom";
      ta.value = md;
      out.appendChild(ta);
      ta.select();
      setStatus(t("exp.md.select"));
    }
  };
}
