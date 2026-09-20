// Product sheet, guide, image and help dialogues.
import { t, tx } from "./i18n";
import { SHOPS, amazonLabel, catEntry, imgUrl, productUrl, shopHref } from "./catalogs";
import { shopOf } from "./store";
import { SPECS, whenOf } from "./specs";
import { GUIDE, HELP } from "./help";
import { $, EXPAND, FIND, LINKOUT, closeDlg, closeOnBackdrop, esc, setHtml, setText } from "./dom";
import type { Model } from "./types";

// A property row out of SPECS. Only some rows carry `when`, so the loop below
// needs one shape for all of them.
type SpecRow = {
  k: string;
  v: (m: Model) => unknown;
  g: (m: Model) => string;
  when?: (m: Model) => boolean;
};

// What showInfo() reads off a CAT_TABS entry.
type CatTab = { id: string; label: string; note: string };

// Properties in a fixed order, rating as color AND symbol
// (color alone doesn't carry the information).
export function specList(kind: string, m: Model) {
  const rows = ((SPECS[kind as keyof typeof SPECS] || []) as SpecRow[])
    .filter((r) => !r.when || r.when(m))
    .map((r) => {
      const g = r.g(m),
        v = r.v(m);
      const mk = g === "ok" ? "✓" : g === "warn" ? "!" : "";
      return `<dt>${esc(t("spec." + r.k))}</dt><dd class="${g}">${mk ? `<span class="mk">${mk}</span>` : ""}${esc(v)}</dd>`;
    });
  return `<dl class="spec">${rows.join("")}</dl>`;
}

export function productBox(kind: string, key: string, m: Model) {
  const name = tx(m.name);
  const direct = productUrl(m);
  const src = imgUrl(kind, key, m);
  // Nothing to buy where nothing costs anything: the "indoor" location gets no
  // retailer search. A product link, if one exists, still stays.
  const shop = !!m.price;
  // Without a price and without a catalog image (the "indoor" location) there's no product photo —
  // then the placeholder stays away instead of drawing a frame around nothing.
  const shot = !!(m.img || m.price);
  return `<div class="product">
    ${
      shot
        ? `<div class="shotbox">
      <img class="shot" src="${esc(src)}" alt="${esc(name)}" loading="lazy" onerror="this.closest('.product').classList.add('noshot')">
      <button class="btn icon zoomup" data-imgfull="${esc(src)}" data-imgtitle="${esc(name)}" title="${esc(t("product.expand"))}" aria-label="${esc(t("product.expand"))}">${EXPAND}</button>
    </div>`
        : ""
    }
    <div class="pbar">
      ${
        direct
          ? `<a class="plink" href="${esc(direct)}" target="_blank" rel="noopener" title="${esc(name)}">${LINKOUT}<span>${esc(t("product.link"))}</span></a>`
          : `<span class="plink none">${esc(name)}</span>`
      }
      ${
        shop
          ? `<span class="shopsel" data-pname="${esc(name)}" data-pamazon="${esc(m.amazon || "")}">
        <a class="go" href="${esc(shopHref(shopOf(), name, m.amazon))}" target="_blank" rel="noopener" title="${esc(t("product.shops"))}" aria-label="${esc(t("product.shops"))}">${FIND}</a>
        <select class="pick" data-shopsel aria-label="${esc(t("product.shops"))}">${SHOPS.map((sh) => `<option value="${esc(sh.label)}" ${sh.label === shopOf().label ? "selected" : ""}>${esc(sh.label === "Amazon" && m.amazon ? amazonLabel(m) : sh.label)}</option>`).join("")}</select>
      </span>`
          : ""
      }
    </div>
  </div>`;
}

export function showProductInfo(kind: string, key: string) {
  const m = catEntry(kind, key),
    dlg = $("infoDlg");
  if (!m || !dlg) return;
  // A router has its own rows, a cable none at all — there the body text carries everything.
  const sk =
    kind === "gear" ? (m.role === "router" ? "router" : null) : kind === "cable" ? null : kind;
  const parts = [sk ? specList(sk, m) : ""];
  if (kind === "cable") {
    parts.push(m.info ? tx(m.info) : `<p>${esc(tx(m.note))}</p>`);
    parts.push(
      `<p class="note">${esc(t("cable.cost", { m: m.m.toFixed(2), fixed: m.fixed }))}</p>`,
    );
  } else {
    if (m.price != null)
      parts.push(`<dl class="spec"><dt>${esc(t("gear.unit"))}</dt><dd>${m.price} €</dd></dl>`);
    // "Good for" / "Less suited" used to be in the panel — it belongs on the datasheet, not in the controls.
    const w = whenOf(kind, key),
      ww = w ? tx(w) : null;
    if (ww)
      parts.push(`<dl class="spec advice">
      <dt>${esc(t("prev.yes"))}</dt><dd class="ok"><span class="mk">✓</span>${esc(ww.yes)}</dd>
      <dt>${esc(t("prev.no"))}</dt><dd class="warn"><span class="mk">!</span>${esc(ww.no)}</dd>
    </dl>`);
    const lead = m.use ? tx(m.use) : kind === "gear" ? tx(m.sub) : "";
    parts.push(
      `<p class="note">${lead ? `<b>${esc(lead)}.</b> ` : ""}${esc(tx(m.note) || "")}` +
        `${kind === "ap" ? " " + esc(t("ap.range", { r: m.radius })) : ""}</p>`,
    );
  }
  // A cable has neither a product page nor an image — then the box stays away.
  if (m.url || m.img || m.price) parts.push(productBox(kind, key, m));
  setText("infoHead", tx(m.name));
  setHtml("infoBody", parts.join(""));
  try {
    dlg.showModal();
  } catch {
    dlg.open = true;
  }
}

export function showGuide(id: string, head: string) {
  const dlg = $("infoDlg");
  if (!dlg || !GUIDE[id]) return;
  setText("infoHead", head);
  setHtml("infoBody", tx(GUIDE[id]));
  try {
    dlg.showModal();
  } catch {
    dlg.open = true;
  }
}

export function showInfo(tab: CatTab) {
  const dlg = $("infoDlg");
  if (!dlg) return;
  setText("infoHead", t(tab.label));
  const parts = [`<p>${esc(t(tab.note))}</p>`];
  if (tab.id === "jb") parts.push(`<p class="tip">${esc(t("cat.jbs.hint"))}</p>`);
  if (GUIDE[tab.id]) parts.push(tx(GUIDE[tab.id]));
  setHtml("infoBody", parts.join(""));
  try {
    dlg.showModal();
  } catch {
    dlg.open = true;
  }
}

// Large product image: 0 = fit, otherwise width as a multiple of the area.
// Works as a magnifier — a full pan-and-zoom tool would be overkill for a product photo.
let imgZoom = 0;

function setImgZoom(z: number) {
  const im = $("imgBig"),
    wrap = $("imgWrap");
  if (!im) return;
  // Remember the center so the visible crop doesn't jump when zooming.
  const rx = im.offsetWidth ? (wrap.scrollLeft + wrap.clientWidth / 2) / im.offsetWidth : 0.5;
  const ry = im.offsetHeight ? (wrap.scrollTop + wrap.clientHeight / 2) / im.offsetHeight : 0.5;
  imgZoom = Math.max(0, Math.min(8, z));
  if (!imgZoom) {
    im.style.width = "";
    im.style.maxWidth = "100%";
    im.style.maxHeight = "100%";
  } else {
    im.style.maxWidth = "none";
    im.style.maxHeight = "none";
    im.style.width = Math.round(imgZoom * 100) + "%";
  }
  if (imgZoom) {
    wrap.scrollLeft = rx * im.offsetWidth - wrap.clientWidth / 2;
    wrap.scrollTop = ry * im.offsetHeight - wrap.clientHeight / 2;
  }
}

function showImage(src: string | null, title: string | null) {
  const d = $("imgDlg");
  if (!d) return;
  setText("imgHead", title || "");
  $("imgBig").src = src;
  $("imgBig").alt = title || "";
  setImgZoom(0);
  try {
    d.showModal();
  } catch {
    d.open = true;
  }
}

function showHelp() {
  const html = HELP.map(
    ([head, rows]) =>
      `<h3 class="subhead">${esc(t(head))}</h3><dl class="spec help">` +
      rows
        .map(([k, key]) => `<dt>${k ? `<kbd>${esc(k)}</kbd>` : "·"}</dt><dd>${esc(t(key))}</dd>`)
        .join("") +
      `</dl>`,
  ).join("");
  setHtml("helpBody", html);
  const d = $("helpDlg");
  try {
    d.showModal();
  } catch {
    d.open = true;
  }
}

export function wireDialogs() {
  $("infoClose").onclick = () => closeDlg($("infoDlg"));

  $("imgIn").onclick = () => setImgZoom(imgZoom ? imgZoom * 1.5 : 1.5);

  $("imgOut").onclick = () => setImgZoom(imgZoom <= 1.5 ? 0 : imgZoom / 1.5);

  $("imgFit").onclick = () => setImgZoom(0);

  $("imgClose").onclick = () => closeDlg($("imgDlg"));

  closeOnBackdrop($("imgDlg"));

  closeOnBackdrop($("infoDlg"));

  closeOnBackdrop($("helpDlg"));

  closeOnBackdrop($("expDlg"));

  $("t-help").onclick = showHelp;

  $("helpClose").onclick = () => closeDlg($("helpDlg"));

  // Drag to pan — scrollbars alone are awkward in the dialog.
  {
    const wrap = $("imgWrap");
    let p0: { x: number; y: number; l: number; t: number } | null = null;
    // Without preventDefault the browser starts its own image drag and
    // panning never gets through.
    wrap.addEventListener("dragstart", (e: Event) => e.preventDefault());
    wrap.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.button) return;
      e.preventDefault();
      p0 = { x: e.clientX, y: e.clientY, l: wrap.scrollLeft, t: wrap.scrollTop };
      wrap.classList.add("grabbing");
      try {
        wrap.setPointerCapture(e.pointerId);
      } catch {}
    });
    wrap.addEventListener("pointermove", (e: PointerEvent) => {
      if (!p0) return;
      e.preventDefault();
      wrap.scrollLeft = p0.l - (e.clientX - p0.x);
      wrap.scrollTop = p0.t - (e.clientY - p0.y);
    });
    const stop = () => {
      p0 = null;
      wrap.classList.remove("grabbing");
    };
    wrap.addEventListener("pointerup", stop);
    wrap.addEventListener("pointercancel", stop);
  }

  $("imgWrap").addEventListener(
    "wheel",
    (e: WheelEvent) => {
      e.preventDefault();
      setImgZoom(
        e.deltaY < 0 ? (imgZoom ? imgZoom * 1.25 : 1.25) : imgZoom <= 1.25 ? 0 : imgZoom / 1.25,
      );
    },
    { passive: false },
  );

  // The box gets rebuilt over and over, so delegate here.
  document.addEventListener("click", (e) => {
    const b = (e.target as Element).closest && (e.target as Element).closest("[data-imgfull]");
    if (b) showImage(b.getAttribute("data-imgfull"), b.getAttribute("data-imgtitle"));
  });
}
