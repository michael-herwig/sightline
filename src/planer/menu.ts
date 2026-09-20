// The planner's own context menu on the map, plus "point at …".
//
// One #ctxMenu node, filled per right-click and emptied again — nothing of it lands in
// `state`, in the share link or in the export. What the menu offers depends only on
// what was clicked; an entry that would not be valid there is left out rather than
// shown greyed out, so the list stays as short as the situation.
import type { Conduit, Item, ItemKind } from "./types";
import { t } from "./i18n";
import { PX_PER_M } from "./geo";
import { CONDUITS } from "./catalogs";
import { isCableRun } from "./conduit";
import { angleAt } from "./geom";
import { draft, drawType, mode, setDraft, state, view } from "./store";
import { $, esc, mapwrap, setStatus } from "./dom";
import { changed } from "./history";
import {
  addItem,
  deleteSelected,
  finishDraft,
  placeKind,
  select,
  startDraw,
  updateHint,
} from "./modes";
import { ON_UI, syncAspect, toSvg } from "./view";
import { applyView, dropVertex, insertVertex, jumpView, renderMap, zoomToCluster } from "./render";
import { showProductInfo } from "./dialogs";

interface Entry {
  label: string;
  run: () => void;
  /** Draws a rule above this entry. */
  sep?: boolean;
  /** `"<kind>:<key>"` — the entry then shows the hover card (see hover.ts). */
  hover?: string;
}

const LONG_PRESS = 500; // ms until a touch counts as a right-click
const PRESS_SLOP = 8; // px of movement that still counts as holding still

// ---------- the menu node ----------

let entries: Entry[] = [];

// `$` hands back `any` (see dom.ts); this is the one node whose type is worth pinning.
const node = (): HTMLElement | null => $("ctxMenu");

export const menuOpen = () => {
  const m = node();
  return !!m && !m.hidden;
};

export function closeMenu() {
  const m = node();
  if (!m || m.hidden) return;
  m.hidden = true;
  m.innerHTML = "";
  entries = [];
}

// Opened at the pointer, then pulled back inside the window — near the right or bottom
// edge the menu would otherwise hang half outside, and on the map there is nothing to
// scroll it back into view.
function openAt(cx: number, cy: number, list: Entry[]) {
  const m = node();
  if (!m || !list.length) return;
  entries = list;
  m.innerHTML = list
    .map(
      (e, i) =>
        (e.sep ? "<hr>" : "") +
        `<button type="button" role="menuitem" tabindex="-1" data-i="${i}"${e.hover ? ` data-hover="${esc(e.hover)}"` : ""}>${esc(e.label)}</button>`,
    )
    .join("");
  m.hidden = false;
  m.style.left = "0px";
  m.style.top = "0px";
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(cx, window.innerWidth - r.width - 4)) + "px";
  m.style.top = Math.max(4, Math.min(cy, window.innerHeight - r.height - 4)) + "px";
  m.querySelector<HTMLElement>("[role=menuitem]")?.focus();
}

// ---------- view helpers ----------

// Centre the map on a point, optionally zooming in to `w` map units wide. A jump, so it
// goes into the browser history like every other one (see render.ts › jumpView).
function centreAt(x: number, y: number, w?: number) {
  jumpView(() => {
    syncAspect();
    if (w && w < view.w) {
      view.h *= w / view.w;
      view.w = w;
    }
    view.x = x - view.w / 2;
    view.y = y - view.h / 2;
    applyView();
  });
}

// ---------- "point at …" ----------
// A transient tool, not a mode: the next click on the map turns the element towards it.
// Nothing about it is stored — Esc, a second menu or a finished click ends it.
let aimId: string | null = null;

export const isAiming = () => !!aimId;

function startAim(it: Item) {
  aimId = it.id;
  mapwrap.classList.add("aiming");
  setStatus(t("ctx.aim.hint", { label: it.label }));
}

export function cancelAim(): boolean {
  if (!aimId) return false;
  aimId = null;
  mapwrap.classList.remove("aiming");
  return true;
}

/** Called from the map's click handler before anything else. True = the click was used up. */
export function aimClick(p: { x: number; y: number }): boolean {
  const it = state.items.find((i) => i.id === aimId);
  if (!cancelAim()) return false;
  if (!it) return true; // the plan changed underneath — swallow the click, change nothing
  it.rot = angleAt(it.x, it.y, p.x, p.y, 0);
  select({ kind: "item", id: it.id });
  changed();
  setStatus(t("ctx.aim.done", { label: it.label, n: it.rot }));
  return true;
}

// ---------- entries per target ----------

// Drawing starts at the click: the template stays the last one chosen, except that
// "conduit" on a cable-run template would draw a cable run — then it falls back to the
// default, which is what the entry says it does.
function beginDraw(key: string, at: { x: number; y: number; at?: string }) {
  startDraw(key);
  setDraft([at]);
  renderMap();
  updateHint();
}

// "Conduit" keeps the last template chosen — except when that is a cable run, because
// then the entry would draw the very thing the one below it is for.
const condKey = () => (isCableRun(CONDUITS[drawType] || {}) ? "fiber" : drawType);

const PLACE: [ItemKind, string][] = [
  ["cam", "ctx.place.cam"],
  ["ap", "ctx.place.ap"],
  ["jb", "ctx.place.jb"],
  ["hub", "ctx.place.hub"],
];

function bgEntries(p: { x: number; y: number }): Entry[] {
  return [
    ...PLACE.map(([kind, key]) => ({ label: t(key), run: () => placeKind(kind, p) })),
    { label: t("ctx.draw.cond"), run: () => beginDraw(condKey(), p), sep: true },
    { label: t("ctx.draw.cable"), run: () => beginDraw("cable", p) },
    { label: t("ctx.centre"), run: () => centreAt(p.x, p.y), sep: true },
  ];
}

function itemEntries(it: Item): Entry[] {
  const at = { x: it.x, y: it.y, at: it.id };
  const out: Entry[] = [];
  // The head end is not a catalogue product — there is no data sheet to open.
  if (it.model) out.push({ label: t("ctx.info"), run: () => showProductInfo(it.kind, it.model!) });
  out.push({ label: t("ctx.from.cond"), run: () => beginDraw(condKey(), at), sep: !!out.length });
  out.push({ label: t("ctx.from.cable"), run: () => beginDraw("cable", at) });
  // Only a camera and an access point have a heading; a junction points nowhere.
  if (it.kind === "cam" || it.kind === "ap")
    out.push({ label: t("ctx.aim"), run: () => startAim(it), sep: true });
  out.push({
    label: t("ctx.dup"),
    run: () => duplicate(it),
    sep: it.kind !== "cam" && it.kind !== "ap",
  });
  out.push({ label: t("ctx.zoom"), run: () => centreAt(it.x, it.y, 40 * PX_PER_M) });
  out.push({
    label: t("ctx.del"),
    sep: true,
    run: () => {
      select({ kind: "item", id: it.id });
      deleteSelected();
    },
  });
  return out;
}

// A copy two metres down the diagonal with a label of its own. Everything else comes
// along, gear included — hence a deep copy, or the two would share the same array. The
// pixel cache e/n stays behind: stampGeo() recomputes it from the new x/y anyway.
function duplicate(it: Item) {
  const d = 2 * PX_PER_M;
  const copy = structuredClone(it) as Partial<Item> & { kind: ItemKind };
  // id, label and position come from addItem. The pixel cache e/n has to go as well,
  // or unstampGeo() would put the copy right back on top of the original.
  for (const k of ["id", "label", "x", "y", "e", "n"] as const) delete copy[k];
  addItem(copy, { x: it.x + d, y: it.y + d }, { shiftKey: false });
}

function condEntries(c: Conduit, p: { x: number; y: number }): Entry[] {
  return [
    { label: t("ctx.vtx.add"), run: () => insertVertex(c, p) },
    { label: t("ctx.select"), run: () => select({ kind: "conduit", id: c.id }) },
    {
      label: t("ctx.del"),
      sep: true,
      run: () => {
        select({ kind: "conduit", id: c.id });
        deleteSelected();
      },
    },
  ];
}

function vtxEntries(c: Conduit, idx: number): Entry[] {
  const out: Entry[] = [];
  // Below two points it is no longer a conduit, so the point has to stay.
  if (c.points.length > 2) out.push({ label: t("ctx.vtx.del"), run: () => dropVertex(c, idx) });
  if (c.points[idx].at)
    out.push({
      label: t("ctx.vtx.free"),
      run: () => {
        const q = c.points[idx];
        c.points[idx] = { x: q.x, y: q.y };
        changed();
      },
    });
  return out;
}

function clusterEntries(grp: Item[]): Entry[] {
  return [
    { label: t("ctx.cluster.in"), run: () => zoomToCluster(grp) },
    ...grp.map((it, i) => ({
      label: it.label,
      sep: i === 0,
      // A group hides what is inside it — the card says which element this row is.
      hover: "item:" + it.id,
      run: () => {
        select({ kind: "item", id: it.id });
        centreAt(it.x, it.y, 40 * PX_PER_M);
      },
    })),
  ];
}

// What was clicked decides the list. Order is the drawing order from the top down:
// handles sit above the markers, markers above the conduits.
function entriesFor(src: Element, p: { x: number; y: number }): Entry[] {
  const near = (sel: string) => (src.closest ? src.closest(sel) : null);
  const v = near("circle.vtx[data-cid]") as SVGElement | null;
  if (v) {
    const c = state.conduits.find((x) => x.id === v.dataset.cid);
    if (c) return vtxEntries(c, +v.dataset.idx!);
  }
  const cl = near("g.marker.cluster[data-ids]") as SVGElement | null;
  if (cl) {
    const grp = cl.dataset
      .ids!.split(" ")
      .map((id) => state.items.find((i) => i.id === id))
      .filter((i): i is Item => !!i);
    if (grp.length) return clusterEntries(grp);
  }
  const mk = near("g.marker[data-id]") as SVGElement | null;
  if (mk) {
    const it = state.items.find((i) => i.id === mk.dataset.id);
    if (it) return itemEntries(it);
  }
  // The cross-section is part of the conduit, not a thing of its own.
  const cd = near("g.conduit[data-id], g.csection[data-id]") as SVGElement | null;
  if (cd) {
    const c = state.conduits.find((x) => x.id === cd.dataset.id);
    if (c) return condEntries(c, p);
  }
  return bgEntries(p);
}

// What sits under the pointer, asked of the document rather than taken from the event:
// a marker and a point handle capture the pointer when they are grabbed, and Chromium
// then retargets the contextmenu that follows to the map — every right-click on an
// element would open the background menu.
function openFor(cx: number, cy: number, fallback: Element) {
  cancelAim();
  const p = toSvg({ clientX: cx, clientY: cy });
  p.x = +p.x.toFixed(1);
  p.y = +p.y.toFixed(1);
  openAt(cx, cy, entriesFor(document.elementFromPoint(cx, cy) ?? fallback, p));
}

// ---------- wiring ----------

export function wireMenu() {
  const m = node();

  // Right-click while drawing finishes the draft, same as Enter — no menu there, or
  // every second point would come with one. Over the on-map controls the browser's own
  // menu stays, so the search field can still be pasted into.
  mapwrap.addEventListener("contextmenu", (e: MouseEvent) => {
    const target = e.target as Element;
    if (target.closest && target.closest(ON_UI)) return;
    e.preventDefault();
    if (mode === "draw") {
      if (draft.length >= 2) finishDraft();
      return;
    }
    openFor(e.clientX, e.clientY, target);
  });

  if (m) {
    m.addEventListener("click", (e: MouseEvent) => {
      const b = (e.target as Element).closest<HTMLElement>("[data-i]");
      if (!b) return;
      const hit = entries[+b.dataset.i!];
      closeMenu();
      hit?.run();
    });

    // Enter and Space come free with <button>; only the roving focus is ours.
    m.addEventListener("keydown", (e: KeyboardEvent) => {
      const items = Array.from(m.querySelectorAll<HTMLElement>("[role=menuitem]"));
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const go = (n: number) => {
        e.preventDefault();
        items[((n % items.length) + items.length) % items.length].focus();
      };
      if (e.key === "ArrowDown") go(i + 1);
      else if (e.key === "ArrowUp") go(i < 0 ? -1 : i - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(items.length - 1);
    });
  }

  // Esc closes the menu, then cancels the aim — and must not also end the current tool
  // in modes.ts, hence capture plus stopPropagation.
  document.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menuOpen()) {
        closeMenu();
        e.stopPropagation();
      } else if (cancelAim()) e.stopPropagation();
    },
    true,
  );

  // Anything that moves the menu away from what it points at closes it.
  // Capture: a marker stops the event on its way down, and the menu would stay open.
  document.addEventListener(
    "pointerdown",
    (e: PointerEvent) => {
      if (!menuOpen()) return;
      const m2 = node();
      if (m2 && m2.contains(e.target as Node)) return;
      closeMenu();
    },
    true,
  );
  window.addEventListener("resize", closeMenu);
  window.addEventListener("blur", closeMenu);
  window.addEventListener("scroll", closeMenu, true);

  wireLongPress();
}

// Touch has no right button: holding still for half a second opens the same menu. The
// pan that the same pointerdown started gets dropped, otherwise the map would keep
// following the finger behind the menu.
function wireLongPress() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sx = 0,
    sy = 0;
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  mapwrap.addEventListener("pointerdown", (e: PointerEvent) => {
    stop();
    const target = e.target as Element;
    if (e.pointerType !== "touch" || mode === "draw") return;
    if (target.closest && target.closest(ON_UI)) return;
    sx = e.clientX;
    sy = e.clientY;
    timer = setTimeout(() => {
      timer = undefined;
      mapwrap.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId }));
      openFor(sx, sy, target);
    }, LONG_PRESS);
  });
  mapwrap.addEventListener("pointermove", (e: PointerEvent) => {
    if (timer && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > PRESS_SLOP) stop();
  });
  mapwrap.addEventListener("pointerup", stop);
  mapwrap.addEventListener("pointercancel", stop);
}
