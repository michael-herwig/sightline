// Appearance factors: size, font, opacity, line width, clustering.
import type { Look } from "./types";
import { renderMap, scheduleSave } from "./hooks";
import { lang } from "./i18n";
import { LOOK, LOOK_DEF, LOOK_RANGE, setLookCache, state } from "./store";
import { $, setText, svg } from "./dom";
import { refreshOffsets, refreshScale } from "./render";

const lookNum = (v: number): string =>
  (Math.round(v * 100) / 100).toLocaleString(lang === "de" ? "de-DE" : "en-GB");

// A saved plan's `look` can predate a field, or (old localStorage junk) carry
// a stray "" from an emptied input — hence `unknown`, checked by hand below.
type LooseLook = Partial<Record<keyof Look, unknown>>;

export function applyLook() {
  const l: LooseLook = state.look || {};
  // cast: setLookCache wants a full Look, but only `cluster` is meaningful here —
  // size/font/alpha/line get overwritten by the loop right below in the same tick
  // (see report: setLookCache's signature doesn't match this call).
  setLookCache({ cluster: l.cluster !== false } as Look);
  for (const key in LOOK_RANGE) {
    const k = key as keyof typeof LOOK_RANGE;
    const lo = LOOK_RANGE[k][0],
      hi = LOOK_RANGE[k][1],
      v = Number(l[k]);
    LOOK[k] =
      isFinite(v) && l[k] !== "" && l[k] != null ? Math.min(hi, Math.max(lo, v)) : LOOK_DEF[k];
  }
  state.look = { ...LOOK };
  svg.style.setProperty("--look-font", String(LOOK.font));
  svg.style.setProperty("--look-alpha", String(LOOK.alpha));
  svg.style.setProperty("--look-line", String(LOOK.line));
  for (const key in LOOK_RANGE) {
    const k = key as keyof typeof LOOK_RANGE;
    const inp = $("look-" + k);
    if (inp && inp !== document.activeElement) inp.value = String(LOOK[k]);
    setText(
      "look-" + k + "-v",
      k === "alpha" ? Math.round(LOOK.alpha * 100) + " %" : lookNum(LOOK[k]),
    );
  }
  const cb = $("look-cluster");
  if (cb) cb.checked = LOOK.cluster;
  refreshScale();
  refreshOffsets();
}

const setLook = (k: keyof Look, v: number | boolean) => {
  // cast: k and v are correlated by the two call sites below (a slider key with
  // a number, or "cluster" with a boolean) — TS can't see that correlation
  // across two independent parameters.
  state.look = { ...state.look, [k]: v } as Look;
  applyLook();
};

export function wireLook() {
  document.querySelectorAll<HTMLInputElement>("#lookPanel [data-look]").forEach((inp) => {
    inp.oninput = () => setLook(inp.dataset.look as keyof Look, +inp.value);
    inp.onchange = () => scheduleSave();
  });

  // Clusters on or off means different markers — that's the only control that redraws.
  $("look-cluster").onchange = (e: Event) => {
    setLook("cluster", (e.target as HTMLInputElement).checked);
    renderMap();
    scheduleSave();
  };

  $("look-reset").onclick = () => {
    state.look = { ...LOOK_DEF };
    applyLook();
    renderMap();
    scheduleSave();
  };
}
