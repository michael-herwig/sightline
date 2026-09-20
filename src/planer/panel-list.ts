// Element list and centring on a selection.
import { createPlan, scheduleSave } from "./hooks";
import { lang, t, tx } from "./i18n";
import { APS, CAMS, JUNCTIONS, shopHref } from "./catalogs";
import { condKind, condName } from "./conduit";
import { pathMid } from "./geom";
import { setSel, shopOf, state, view } from "./store";
import { gearNames } from "./gear";
import { linkText, links } from "./links";
import { costs } from "./costs";
import { $, ICONS, TRASH, esc, fmt, h, openPanel, pane, selKey } from "./dom";
import { boundCount } from "./bonds";
import { deleteSelected, select } from "./modes";
import { syncAspect } from "./view";
import { applyView, jumpView, syncJump } from "./render";
import { exportPlan, importPlan } from "./share";
import type { Item, Sel, SelKind } from "./types";

export function renderList() {
  const c = costs(),
    L = links();
  // Finding and source belong in the signature, otherwise the row stays stale.
  const stKey = (id: string) => {
    const s = L.status.get(id),
      r = L.src.get(id);
    return (
      (s ? s.g + ":" + linkText(s) : "") + (r ? "@" + r.src.label + ":" + r.len.toFixed(0) : "")
    );
  };
  // Subtitle of a camera or an AP: where the power comes from — or what's missing.
  const feed = (i: Item) => {
    const s = L.status.get(i.id),
      r = L.src.get(i.id);
    const txt =
      s && s.g !== "ok"
        ? linkText(s)
        : r
          ? t(i.note ? "list.src" : "list.feed", { src: r.src.label, len: r.len.toFixed(0) })
          : "";
    if (!txt) return i.note || "–";
    return i.note ? i.note + " · " + txt : txt;
  };
  const sig =
    "list:" +
    lang +
    "|" +
    JSON.stringify([
      c.cams.map((i) => [i.id, i.label, i.model, i.note, stKey(i.id)]),
      c.aps.map((i) => [i.id, i.label, i.model, i.note, stKey(i.id)]),
      c.jbs.map((i) => [
        i.id,
        i.label,
        i.model,
        gearNames(i),
        boundCount(i.id),
        i.price,
        stKey(i.id),
      ]),
      c.hubs.map((i) => [i.id, gearNames(i), stKey(i.id)]),
      c.infra.map((i) => [i.id, i.qty]),
      c.conds.map((i) => [i.id, i.label, condName(i), i.c.len.toFixed(1), i.c.total.toFixed(2)]),
    ]);
  const p = pane("pane-list", sig, (pn) => {
    pn.appendChild(
      h(`<h2>${esc(t("list.cams", { n: c.cams.length }))}</h2><div class="list" id="l-cams"></div>
      <h2>${esc(t("list.aps", { n: c.aps.length }))}</h2><div class="list" id="l-aps"></div>
      <h2>${esc(t("list.jbs", { n: c.jbs.length }))}</h2><div class="list" id="l-jbs"></div>
      <h2>${esc(t("list.gear", { n: c.infra.length }))}</h2><div class="list" id="l-gear"></div>
      <h2>${esc(t("list.conds", { n: c.conds.length }))}</h2><div class="list" id="l-conds"></div>`),
    );
    // The dot before the price carries the connection status; the title names the reason.
    const dot = (id: string) => {
      const s = L.status.get(id);
      return s && s.g !== "ok" ? `<span class="st ${s.g}" title="${esc(linkText(s))}"></span>` : "";
    };
    const row = (
      cls: string,
      badge: string,
      title: string | undefined,
      sub: string,
      price: string,
      s: Sel,
      mark?: string,
    ) => {
      const r = h(
        `<div class="lrow" data-sk="${s.kind}:${s.id}"><span class="b ${cls}">${badge}</span><span class="t">${esc(title)}<small>${esc(sub)}</small></span><span class="p">${mark || ""}${price}</span><button class="del" title="${esc(t("f.del"))}" aria-label="${esc(t("f.del"))}">${TRASH}</button></div>`,
      ).firstElementChild as HTMLElement;
      r.onclick = () => {
        select(s);
        centerOn(s);
      };
      r.querySelector<HTMLElement>(".del")!.onclick = (e: Event) => {
        e.stopPropagation();
        setSel(s);
        deleteSelected();
      };
      return r;
    };
    if (!c.cams.length)
      $("l-cams").appendChild(
        h(`<div class="empty">${esc(t("list.empty.cams"))}</div>`).firstElementChild!,
      );
    c.cams.forEach((i) =>
      $("l-cams").appendChild(
        row(
          "cam",
          esc(i.label),
          CAMS[i.model as string].name as string,
          feed(i),
          fmt(i.price),
          { kind: "item", id: i.id },
          dot(i.id),
        ),
      ),
    );
    c.aps.forEach((i) =>
      $("l-aps").appendChild(
        row(
          "ap",
          esc(i.label),
          APS[i.model as string].name as string,
          feed(i),
          fmt(i.price),
          { kind: "item", id: i.id },
          dot(i.id),
        ),
      ),
    );
    // Subtitle: what's here — or, if nothing's in it, how many conduits end here.
    c.jbs.forEach((i) =>
      $("l-jbs").appendChild(
        row(
          "jb",
          esc(i.label),
          tx(JUNCTIONS[i.model as string].name),
          gearNames(i) || t("jb.bound.n", { n: boundCount(i.id) }),
          fmt(i.price),
          { kind: "item", id: i.id },
          dot(i.id),
        ),
      ),
    );
    c.infra.forEach((i) =>
      $("l-gear").appendChild(
        row("gear", ICONS.gear, tx(i.name), i.qty + " × · " + tx(i.sub), fmt(i.price * i.qty), {
          kind: "infra",
          id: i.id,
        }),
      ),
    );
    c.conds.forEach((i) =>
      $("l-conds").appendChild(
        row(
          "cond " + condKind(i),
          "",
          i.label,
          t("list.cond.sub", { name: condName(i), len: i.c.len.toFixed(0) }),
          fmt(i.c.total),
          { kind: "conduit", id: i.id },
        ),
      ),
    );
    pn.appendChild(
      h(
        `<div class="row"><button class="btn" id="l-new">${esc(t("plan.new"))}</button><button class="btn" id="l-export">${esc(t("btn.export"))}</button><button class="btn" id="l-import">${esc(t("btn.import"))}</button><input type="file" id="l-file" accept="application/json" hidden></div>`,
      ),
    );
    $("l-export").onclick = exportPlan;
    $("l-import").onclick = () => $("l-file").click();
    $("l-file").onchange = (e: Event) => {
      const f = (e.target as HTMLInputElement).files![0];
      if (f) importPlan(f);
      (e.target as HTMLInputElement).value = "";
    };
    $("l-new").onclick = () => createPlan();
  });
  if (!p) return;
  const k = selKey();
  p.querySelectorAll(".lrow[data-sk]").forEach((r: HTMLElement) =>
    r.classList.toggle("selected", r.dataset.sk === k),
  );
}

function centerOn(s: Sel) {
  let p;
  if (s.kind !== "item" && s.kind !== "conduit") return; // hub has no position
  if (s.kind === "item") {
    const it = state.items.find((i) => i.id === s.id);
    p = it && { x: it.x, y: it.y };
  } else {
    const c = state.conduits.find((x) => x.id === s.id);
    p = c && pathMid(c.points);
  }
  if (!p) return;
  openPanel("map");
  // If the map panel becomes active in the process, dockview only resizes it afterward.
  // syncAspect() still computes with the old aspect ratio at that point — the height is
  // off while the width is right. So just retry; centering is idempotent.
  const go = () => {
    syncAspect();
    view.x = p.x - view.w / 2;
    view.y = p.y - view.h / 2;
    applyView();
  };
  jumpView(go);
  const again = () => {
    go();
    syncJump();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(again);
  setTimeout(again, 160);
}

export function wirePanelList() {
  // Jump targets from the connection rows — the box gets replaced via setHtml.
  document.addEventListener("click", (e) => {
    const b = (e.target as Element).closest && (e.target as Element).closest("[data-goto]");
    if (!b) return;
    const i = b.getAttribute("data-goto")!.indexOf(":");
    const s = {
      // The attribute is written as "<kind>:<id>" by the connection rows.
      kind: b.getAttribute("data-goto")!.slice(0, i) as SelKind,
      id: b.getAttribute("data-goto")!.slice(i + 1),
    };
    select(s);
    centerOn(s);
  });

  document.addEventListener("change", (e) => {
    const pick =
      (e.target as Element).closest &&
      (e.target as Element).closest<HTMLSelectElement>("[data-shopsel]");
    if (!pick) return;
    state.shop = pick.value;
    scheduleSave();
    // There can be more than one bar (selection and preview) — update all of them.
    document.querySelectorAll<HTMLElement>(".shopsel").forEach((box) => {
      const sh = shopOf(),
        nm = box.getAttribute("data-pname") || "";
      box.querySelector<HTMLAnchorElement>("a.go")!.href = shopHref(
        sh,
        nm,
        box.getAttribute("data-pamazon") || "",
      );
      box.querySelectorAll("option").forEach((o) => {
        o.selected = o.value === sh.label;
      });
    });
  });
}
