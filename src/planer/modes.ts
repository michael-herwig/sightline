// @ts-nocheck
// Tools and selection: mode, placing, drawing, deleting, the tool bar and keys.
import { renderMap, renderSide, scheduleSave } from "./hooks";
import { t } from "./i18n";
import { APS, CAMS, CONDUITS, KIND_PREFIX } from "./catalogs";
import { condCables, condName, isCableRun } from "./conduit";
import { migrateConduit } from "./migrate";
import { polyLength } from "./geom";
import {
  draft,
  drawType,
  mode,
  nextLabel,
  placeAp,
  placeModel,
  sel,
  setCatTab,
  setDraft,
  setDrawType,
  setModeName,
  setPreview,
  setSel,
  state,
  uid,
} from "./store";
import { $, mapwrap, openPanel, setStatus } from "./dom";
import { unbindAll } from "./bonds";
import { changed, redo, undo } from "./history";

export function addItem(base, p, e) {
  const it = {
    id: uid(),
    label: nextLabel(KIND_PREFIX[base.kind]),
    x: p.x,
    y: p.y,
    note: "",
    ...base,
  };
  state.items.push(it);
  select({ kind: "item", id: it.id });
  changed();
  if (!e.shiftKey) setMode("select");
}

export function finishDraft() {
  if (draft.length >= 2) {
    const pre = CONDUITS[drawType] || CONDUITS.pipe;
    // The name comes from duct and cables, not from the template — otherwise it would later say
    // "DN 50 + fiber" over a trench with no duct and Cat6A inside.
    // Deep copy: otherwise template and conduit would share the same duct and cable objects.
    const nc = migrateConduit({
      id: uid(),
      kind: pre.kind,
      label: "",
      points: draft.slice(),
      ducts: pre.ducts.map((d) => ({ pipe: d.pipe, cables: d.cables.map((x) => ({ ...x })) })),
    });
    // Fiber never goes directly into a camera or access point — there's
    // no SFP slot there. If the draft ends at such a device, it becomes Cat6A;
    // at a hub, switch, or junction, the fiber stays as is.
    const noSfp = [draft[0], draft[draft.length - 1]]
      .map((p) => p.at && state.items.find((i) => i.id === p.at))
      .find((it) => it && (it.kind === "cam" || it.kind === "ap"));
    if (noSfp && condCables(nc).some((x) => x.type === "fiber")) {
      // Only the fiber gets swapped, ducts and everything else stay put.
      nc.ducts.forEach((d) => {
        d.cables = d.cables.map((x) => (x.type === "fiber" ? { type: "cat", n: x.n } : x));
      });
      setStatus(t("draw.autocat", { label: noSfp.label }));
    }
    nc.label = condName(nc);
    state.conduits.push(nc);
    setDraft([]);
    select({ kind: "conduit", id: nc.id });
    changed();
  } else {
    setDraft([]);
    renderMap();
  }
  setMode("select");
}

// ---------- Modes ----------
const MODE_TOOL = {
  select: "select",
  "place-cam": "cam",
  "place-ap": "ap",
  "place-jb": "jb",
  "place-hub": "hub",
  draw: "draw",
};

// Drawing is one mode but two buttons: "Conduit" lays a trench with ducts
// (default fiber), "Cable" a cable run without a duct. The matching one shows pressed —
// decided by the kind of template, not by the cable inside it.
const toolOf = (m) =>
  m === "draw" ? (isCableRun(CONDUITS[drawType] || {}) ? "cable" : "draw") : MODE_TOOL[m];

export function setMode(m) {
  setModeName(m);
  if (m !== "draw") setDraft([]);
  // Tapping a model in the catalog means: I want to see and place this here.
  // The selection on the map must yield for that, otherwise the preview stays hidden.
  if (m !== "select") setSel(null);
  ["select", "cam", "ap", "jb", "hub", "draw", "cable"].forEach((k) =>
    $("t-" + k).setAttribute("aria-pressed", String(toolOf(m) === k)),
  );
  $("t-finish").hidden = m !== "draw";
  const tb = { "place-cam": "cam", "place-ap": "ap", "place-jb": "jb", draw: "cond" }[m];
  if (tb) {
    setCatTab(tb);
    state.catTab = tb;
  }
  mapwrap.className =
    "mapwrap " + (m === "select" ? "mode-select" : m === "draw" ? "mode-draw" : "mode-place");
  renderMap();
  updateHint();
  renderSide();
  if (m !== "select") openPanel("build");
}

export function updateHint() {
  const h2 = $("hint");
  if (!h2) return; // the hint line is gone; the help explains the tools
  if (mode === "select")
    h2.textContent = sel ? t(sel.kind === "conduit" ? "hint.vtx" : "hint.sel") : t("hint.idle");
  else if (mode === "place-cam") h2.textContent = t("hint.cam", { name: CAMS[placeModel].name });
  else if (mode === "place-ap") h2.textContent = t("hint.ap", { name: APS[placeAp].name });
  else if (mode === "place-jb") h2.textContent = t("hint.jb");
  else if (mode === "place-hub") h2.textContent = t("hint.hub");
  else if (mode === "draw")
    h2.textContent = draft.length
      ? t("hint.drawN", { n: draft.length, m: polyLength(draft).toFixed(0) })
      : t("hint.draw0");
}

export function applyToolLabels() {
  $("palette").classList.toggle("labels", !!state.toolLabels);
}

// "Cable" is the same drawing, just with a cable-run template — no trench and
// no duct. The catalog shows which entry is pressed.
function drawCable() {
  setDrawType("cable");
  setPreview({ kind: "cond", key: "cable" });
  setMode("draw");
}

// Selection no longer switches the tab — properties live in the ribbon above.
export function select(s) {
  const same = (!s && !sel) || (!!s && !!sel && s.kind === sel.kind && s.id === sel.id);
  setSel(s);
  if (!same) renderMap(); // otherwise the just-clicked node gets replaced
  renderSide();
  updateHint();
}

export function deleteSelected() {
  if (!sel) return;
  // Hub and accessories aren't on the map: deleting means "not planned".
  if (sel.kind === "infra") {
    const cur = state.infra[sel.id] || {};
    state.infra[sel.id] = { on: false, qty: Math.max(1, cur.qty || 1) };
    setSel(null);
    changed();
    return;
  }
  if (sel.kind === "item") {
    const it = state.items.find((i) => i.id === sel.id);
    if (it) unbindAll(it.id);
    state.items = state.items.filter((i) => i.id !== sel.id);
  } else state.conduits = state.conduits.filter((c) => c.id !== sel.id);
  setSel(null);
  changed();
}

export function wireModes() {
  $("t-labels").onclick = () => {
    state.toolLabels = !state.toolLabels;
    applyToolLabels();
    scheduleSave();
  };

  $("t-select").onclick = () => setMode("select");

  $("t-cam").onclick = () => setMode(mode === "place-cam" ? "select" : "place-cam");

  $("t-ap").onclick = () => setMode(mode === "place-ap" ? "select" : "place-ap");

  $("t-jb").onclick = () => setMode(mode === "place-jb" ? "select" : "place-jb");

  $("t-hub").onclick = () => setMode(mode === "place-hub" ? "select" : "place-hub");

  $("t-draw").onclick = () => setMode(toolOf(mode) === "draw" ? "select" : "draw");

  $("t-cable").onclick = () => {
    if (toolOf(mode) === "cable") return setMode("select");
    drawCable();
  };

  $("t-finish").onclick = finishDraft;

  $("t-undo").onclick = undo;

  $("t-redo").onclick = redo;

  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase(),
      inField = tag === "input" || tag === "textarea" || tag === "select";
    // Esc from within a field (search, vendor picker) should end the mode in one step,
    // not just leave the field and cancel on the second press.
    if (inField && e.key === "Escape") e.target.blur();
    else if (inField) return;
    if (e.ctrlKey || e.metaKey) {
      const k = (e.key || "").toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        return undo();
      }
      if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        return redo();
      }
      return;
    }
    if (e.key === "Escape") {
      if (mode === "draw" && draft.length) {
        setDraft([]);
        renderMap();
        updateHint();
      } else {
        setPreview(null);
        setMode("select");
      }
      select(null);
    } else if (e.key === "Enter" && mode === "draw") finishDraft();
    else if ((e.key === "Delete" || e.key === "Backspace") && sel) {
      deleteSelected();
    } else if (e.key === "v" || e.key === "V") setMode("select");
    else if (e.key === "k" || e.key === "K") setMode("place-cam");
    else if (e.key === "a" || e.key === "A") setMode("place-ap");
    else if (e.key === "j" || e.key === "J") setMode("place-jb");
    else if (e.key === "h" || e.key === "H") setMode("place-hub");
    else if (e.key === "l" || e.key === "L") setMode("draw");
    else if (e.key === "c" || e.key === "C") drawCable();
  });
}
