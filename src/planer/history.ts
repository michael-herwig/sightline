// @ts-nocheck
// Undo/redo over JSON snapshots, plus the mutate-and-record entry points.
import { renderMap, renderSide, scheduleSave, updateHint } from "./hooks";
import { condName, isAutoLabel } from "./conduit";
import { setSel, state } from "./store";
import { $ } from "./dom";
import { syncBonds } from "./bonds";

// Check first, then change: after the change the old name would no longer look automatic.
export function condEdit(c, mutate) {
  const auto = isAutoLabel(c);
  mutate();
  if (auto) c.label = condName(c);
  changed();
}

// ---------- Persistence ----------
// ---------- Undo / Redo ----------
// The working state is small and serializable, so snapshots are enough.
// ponytail: no command pattern — JSON copies, capped at HIST_MAX.
const HIST_MAX = 60;

const HIST_KEYS = ["items", "conduits", "infra", "budget", "earthwork", "seq"];

let past = [],
  future = [],
  histNow = null;

function snapState() {
  const o = {};
  HIST_KEYS.forEach((k) => (o[k] = state[k]));
  return JSON.stringify(o);
}

export function histInit() {
  past = [];
  future = [];
  histNow = snapState();
  updateHist();
}

function histPush() {
  const s2 = snapState();
  if (histNow === null) {
    histNow = s2;
    return;
  }
  if (s2 === histNow) return;
  past.push(histNow);
  if (past.length > HIST_MAX) past.shift();
  future.length = 0;
  histNow = s2;
  updateHist();
}

function histApply(s2) {
  Object.assign(state, JSON.parse(s2));
  histNow = s2;
  setSel(null);
  syncBonds();
  renderMap();
  renderSide();
  updateHint();
  updateHist();
  scheduleSave();
}

export function undo() {
  if (!past.length) return;
  future.push(histNow);
  histApply(past.pop());
}

export function redo() {
  if (!future.length) return;
  past.push(histNow);
  histApply(future.pop());
}

function updateHist() {
  const u = $("t-undo"),
    r = $("t-redo");
  if (u) u.disabled = !past.length;
  if (r) r.disabled = !future.length;
}

export function changed() {
  histPush();
  renderMap();
  renderSide();
  scheduleSave();
}
