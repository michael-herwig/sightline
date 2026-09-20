// Pointer handling on the map: pan, drag, rotate, place, draw.
import { renderMap, renderSide, scheduleSave, updateHint } from "./hooks";
import { t } from "./i18n";
import { isHousing } from "./catalogs";
import { angleAt } from "./geom";
import { draft, drag, mode, placeAp, placeJb, placeModel, setDrag, view } from "./store";
import { $, mapwrap, svg } from "./dom";
import { snapTarget, syncBonds } from "./bonds";
import { changed } from "./history";
import { addItem, finishDraft, select } from "./modes";
import { toSvg } from "./view";
import { applyBasemap, closeMapMenus } from "./tiles";
import { applyView, fit, jumpView, refreshConduit, refreshItem, zoomAt } from "./render";

// The controls live inside mapwrap. Without this check, a click on
// the layer selector would start a pan whose pointerup gets lost in the selection menu —
// after that, the map sticks to the pointer.
const ON_UI = ".mapui-tl, .mapui-br, .zoom, .palette, .toast";

// Grabbing the map means you're done with the text field. Otherwise the
// plan name stays in edit mode while the map is already being dragged.
function dropFocus() {
  // closeMapMenus(except) takes an optional argument; tiles.ts is still untyped,
  // so the parameter reads as required until it is annotated there.
  if ($("layerMenu")) closeMapMenus();
  const a = document.activeElement as HTMLElement | null;
  if (a && a !== document.body && typeof a.blur === "function") a.blur();
}

// Pointer events arrive faster than frames get drawn. Once per frame is enough.
// Only the three fields applyDrag() reads — the frame callback gets a copy, not the event.
type MoveEvt = { clientX: number; clientY: number; shiftKey: boolean };

let moveEvt: MoveEvt | null = null,
  moveQueued = false;

function applyDrag(e: MoveEvt) {
  if (drag.target.type === "pan") {
    const k = view.w / (svg.clientWidth || 1);
    const dx = (e.clientX - drag.sx) * k,
      dy = (e.clientY - drag.sy) * k;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    view.x = drag.vx - dx;
    view.y = drag.vy - dy;
    applyView();
    return;
  }
  const p = toSvg(e);
  if (drag.target.type === "rot") {
    const it = drag.target.it;
    it.rot = angleAt(it.x, it.y, p.x, p.y, e.shiftKey ? 15 : 0);
    if (it.rot !== drag.orot) drag.moved = true;
    const sl = $("f-rot");
    if (sl) {
      sl.value = it.rot;
      $("f-rot-val").textContent = t("f.rot.val", { n: it.rot });
    }
    refreshItem(it);
    return;
  }
  const dx = p.x - drag.sx,
    dy = p.y - drag.sy;
  if (Math.abs(dx) + Math.abs(dy) > 1) drag.moved = true;
  if (drag.target.type === "item") {
    const it = drag.target.it;
    it.x = +(drag.orig.x + dx).toFixed(1);
    it.y = +(drag.orig.y + dy).toFixed(1);
    syncBonds();
    refreshItem(it);
  } else if (drag.target.type === "vtx") {
    const nx = +(drag.orig.x + dx).toFixed(1),
      ny = +(drag.orig.y + dy).toFixed(1);
    // Snaps to a junction; pulling farther away than the radius releases the bond.
    const hit = snapTarget(nx, ny);
    // A new or released bond counts as a change, even without any distance moved —
    // otherwise it wouldn't land in history and the connection status would stay stale.
    const was = drag.target.c.points[drag.target.idx].at;
    if ((hit ? hit.id : undefined) !== was) drag.moved = true;
    drag.target.c.points[drag.target.idx] = hit
      ? { x: hit.x, y: hit.y, at: hit.id }
      : { x: nx, y: ny };
    refreshConduit(drag.target.c);
  }
}

function endDrag() {
  if (!drag) return;
  moveEvt = null;
  const wasPan = drag.target.type === "pan",
    moved = drag.moved;
  setDrag(null);
  mapwrap.classList.remove("panning");
  mapwrap.classList.remove("rotating");
  if (wasPan) {
    if (!moved) select(null);
    else {
      applyBasemap(0);
      scheduleSave();
    }
    return;
  }
  if (moved) changed();
  else renderSide();
}

export function wireDrag() {
  mapwrap.addEventListener("pointerdown", (e: PointerEvent) => {
    if ((e.target as Element).closest && (e.target as Element).closest(ON_UI)) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dropFocus();
    e.preventDefault(); // otherwise the browser selects the SVG labels
    if (mode === "select") {
      setDrag({
        target: { type: "pan" },
        sx: e.clientX,
        sy: e.clientY,
        vx: view.x,
        vy: view.y,
        moved: false,
      });
      mapwrap.classList.add("panning");
      try {
        if (mapwrap.setPointerCapture) mapwrap.setPointerCapture(e.pointerId);
      } catch {}
    }
  });

  mapwrap.addEventListener("pointermove", (e: PointerEvent) => {
    if (!drag) return;
    moveEvt = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey };
    if (moveQueued) return;
    moveQueued = true;
    requestAnimationFrame(() => {
      moveQueued = false;
      if (drag && moveEvt) applyDrag(moveEvt);
    });
  });

  mapwrap.addEventListener("pointerup", endDrag);

  mapwrap.addEventListener("pointercancel", endDrag);

  // Safety net: releasing can also happen outside the map.
  window.addEventListener("pointerup", endDrag);

  window.addEventListener("blur", () => {
    if (drag) endDrag();
  });

  // click actions for place / draw
  // Right-click while drawing finishes the draft, same as Enter. Outside draw
  // mode the browser menu stays until the planner has its own.
  mapwrap.addEventListener("contextmenu", (e: MouseEvent) => {
    if (mode !== "draw") return;
    e.preventDefault();
    if (draft.length >= 2) finishDraft();
  });

  mapwrap.addEventListener("click", (e: MouseEvent) => {
    if (mode === "select") return;
    // A click on the tool button itself bubbles up to here — otherwise the element
    // would land right under the palette.
    if ((e.target as Element).closest && (e.target as Element).closest(ON_UI)) return;
    const p = toSvg(e);
    p.x = +p.x.toFixed(1);
    p.y = +p.y.toFixed(1);
    if (mode === "place-cam") addItem({ kind: "cam", model: placeModel, rot: 90 }, p, e);
    else if (mode === "place-ap") addItem({ kind: "ap", model: placeAp }, p, e);
    // A device from the catalog brings its own point — default: inside the building.
    else if (mode === "place-jb")
      addItem(
        isHousing(placeJb)
          ? { kind: "jb", model: placeJb, gear: [] }
          : { kind: "jb", model: "indoor", gear: [{ model: placeJb, n: 1 }] },
        p,
        e,
      );
    else if (mode === "place-hub")
      addItem({ kind: "hub", wan: { type: "fiber", speed: 1000 } }, p, e);
    else if (mode === "draw") {
      const hit = snapTarget(p.x, p.y);
      draft.push(hit ? { x: hit.x, y: hit.y, at: hit.id } : p);
      renderMap();
      updateHint();
    }
  });

  mapwrap.addEventListener("dblclick", (e: MouseEvent) => {
    if (mode === "draw") {
      e.preventDefault();
      finishDraft();
    }
  });

  mapwrap.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      e.preventDefault();
      const p = toSvg(e);
      zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, p.x, p.y);
    },
    { passive: false },
  );

  $("z-in").onclick = () => zoomAt(1.4, view.x + view.w / 2, view.y + view.h / 2);

  $("z-out").onclick = () => zoomAt(1 / 1.4, view.x + view.w / 2, view.y + view.h / 2);

  $("z-fit").onclick = () => jumpView(fit); // ⌂ is a jump, so it goes into history

  window.addEventListener("resize", applyView);

  if (window.ResizeObserver) new ResizeObserver(() => applyView()).observe(mapwrap);
}
