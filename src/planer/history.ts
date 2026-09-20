// Undo/redo over JSON snapshots, plus the mutate-and-record entry points.
import type { Conduit, State } from "./types";
import { renderMap, renderSide, scheduleSave, updateHint } from "./hooks";
import { condName, isAutoLabel } from "./conduit";
import { setSel, state } from "./store";
import { $ } from "./dom";
import { syncBonds } from "./bonds";

// Check first, then change: after the change the old name would no longer look automatic.
export function condEdit(c: Conduit, mutate: () => void) {
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

const HIST_KEYS = ["items", "conduits", "infra", "budget", "earthwork", "seq"] as const;

let past: string[] = [],
  future: string[] = [],
  histNow: string | null = null;

function snapState() {
  const o: Partial<State> = {};
  HIST_KEYS.forEach((k) => ((o as Record<string, unknown>)[k] = state[k]));
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

function histApply(s2: string) {
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
  future.push(histNow as string);
  histApply(past.pop() as string);
}

export function redo() {
  if (!future.length) return;
  past.push(histNow as string);
  histApply(future.pop() as string);
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
