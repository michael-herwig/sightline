// @ts-nocheck
// Build panel: catalogue tabs, search field, filter badges.
import { scheduleSave } from "./hooks";
import { lang, t } from "./i18n";
import { catFacets, catQuery, catTab, setCatTab, state } from "./store";
import { CAT_TABS, FACET_SETS } from "./specs";
import { $, ICONS, INFO, esc, h, pane, setVal } from "./dom";
import { showInfo } from "./dialogs";
import { FILL, syncPressed } from "./catalog";

export function renderBuild() {
  const tab = CAT_TABS.find((x) => x.id === catTab) || CAT_TABS[0];
  // The tab belongs in the signature: switching it is a real content change.
  // Clicking a model isn't — so the scroll position stays put there.
  const p = pane("pane-build", `build:${lang}:${tab.id}`, (root) => {
    root.appendChild(
      h(`
      <div class="segs" id="cat-tabs" role="tablist"></div>
      <div class="searchrow">
        <select id="cat-vendor" hidden aria-label="${esc(t("facet.vendor"))}"></select>
        <input type="search" id="cat-q" value="${esc(catQuery[tab.id] || "")}" placeholder="${esc(t("cat.search." + tab.id))}" autocomplete="off">
        <button class="btn info" id="cat-info" title="${esc(t("info.title"))}" aria-label="${esc(t("info.title"))}">${INFO}</button>
      </div>
      <div class="chips" id="cat-chips"></div>
      <div class="cat" id="${tab.box}"></div>`),
    );
    $("cat-info").onclick = () => showInfo(tab);

    const tabs = $("cat-tabs");
    CAT_TABS.forEach((x) => {
      const b = h(
        `<button class="seg" role="tab" data-tab="${x.id}" title="${esc(t(x.label))}">${ICONS[x.id]}<span>${esc(t(x.tab))}</span></button>`,
      ).firstElementChild;
      b.onclick = () => {
        setCatTab(x.id);
        state.catTab = x.id;
        renderBuild();
        scheduleSave();
      };
      tabs.appendChild(b);
    });

    // Manufacturer as a dropdown next to the search: exactly one or all.
    const vsel = $("cat-vendor"),
      vendors = (FACET_SETS[tab.id] || []).filter((f) => f.group === "vendor");
    vsel.hidden = !vendors.length;
    if (vendors.length) {
      vsel.innerHTML = "";
      [{ id: "", label: t("facet.vendor.all") }, ...vendors].forEach((f) => {
        const o = document.createElement("option");
        o.value = f.id;
        o.textContent = f.label;
        vsel.appendChild(o);
      });
      vsel.value = (vendors.find((f) => catFacets.has(f.id)) || { id: "" }).id;
      vsel.onchange = () => {
        vendors.forEach((f) => catFacets.delete(f.id));
        if (vsel.value) catFacets.add(vsel.value);
        state.catFacets = [...catFacets];
        renderBuild();
        scheduleSave();
      };
    }
    const chips = $("cat-chips");
    (FACET_SETS[tab.id] || [])
      .filter((f) => f.group !== "vendor")
      .forEach((f) => {
        const b = h(
          `<button class="chip" data-facet="${f.id}">${esc(f.i18n ? t(f.label) : f.label)}</button>`,
        ).firstElementChild;
        b.onclick = () => {
          if (catFacets.has(f.id)) catFacets.delete(f.id);
          else catFacets.add(f.id);
          state.catFacets = [...catFacets];
          renderBuild();
          scheduleSave();
        };
        chips.appendChild(b);
      });
    const r = h(
      `<button class="chip clear" id="cat-clear">${esc(t("cat.reset"))}</button>`,
    ).firstElementChild;
    r.onclick = () => {
      (FACET_SETS[tab.id] || []).forEach((f) => catFacets.delete(f.id));
      catQuery[tab.id] = "";
      state.catQuery = catQuery;
      state.catFacets = [...catFacets];
      renderBuild();
      scheduleSave();
    };
    chips.appendChild(r);
    // Only refill the list, not the panel — otherwise the search field loses focus.
    $("cat-q").oninput = (e) => {
      catQuery[tab.id] = e.target.value;
      state.catQuery = catQuery;
      renderBuild();
      scheduleSave();
    };
  });
  if (!p) return;
  setVal("cat-q", catQuery[tab.id] || "");
  p.querySelectorAll("[data-tab]").forEach((b) => {
    const on = b.dataset.tab === tab.id;
    b.setAttribute("aria-selected", String(on));
    b.setAttribute("aria-pressed", String(on));
  });
  p.querySelectorAll("[data-facet]").forEach((b) =>
    b.setAttribute("aria-pressed", String(catFacets.has(b.dataset.facet))),
  );
  const vs = $("cat-vendor");
  if (vs && !vs.hidden)
    vs.value = [...vs.options].map((o) => o.value).find((v) => v && catFacets.has(v)) || "";
  const used = (FACET_SETS[tab.id] || []).some((f) => catFacets.has(f.id)) || !!catQuery[tab.id];
  const cl = $("cat-clear");
  if (cl) cl.hidden = !used;
  FILL[tab.id]();
  syncPressed(p);
}
