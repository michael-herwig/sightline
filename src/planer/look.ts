// @ts-nocheck
// Appearance factors: size, font, opacity, line width, clustering.
import { renderMap, scheduleSave } from "./hooks";
import { lang } from "./i18n";
import { LOOK, LOOK_DEF, LOOK_RANGE, setLookCache, state } from "./store";
import { $, setText, svg } from "./dom";
import { refreshOffsets, refreshScale } from "./render";

const lookNum = (v) =>
  (Math.round(v * 100) / 100).toLocaleString(lang === "de" ? "de-DE" : "en-GB");

export function applyLook() {
  const l = state.look || {};
  setLookCache({ cluster: l.cluster !== false });
  for (const k in LOOK_RANGE) {
    const lo = LOOK_RANGE[k][0],
      hi = LOOK_RANGE[k][1],
      v = +l[k];
    LOOK[k] =
      isFinite(v) && l[k] !== "" && l[k] != null ? Math.min(hi, Math.max(lo, v)) : LOOK_DEF[k];
  }
  state.look = { ...LOOK };
  svg.style.setProperty("--look-font", String(LOOK.font));
  svg.style.setProperty("--look-alpha", String(LOOK.alpha));
  svg.style.setProperty("--look-line", String(LOOK.line));
  for (const k in LOOK_RANGE) {
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

const setLook = (k, v) => {
  state.look = { ...state.look, [k]: v };
  applyLook();
};

export function wireLook() {
  document.querySelectorAll("#lookPanel [data-look]").forEach((inp) => {
    inp.oninput = () => setLook(inp.dataset.look, +inp.value);
    inp.onchange = () => scheduleSave();
  });

  // Clusters on or off means different markers — that's the only control that redraws.
  $("look-cluster").onchange = (e) => {
    setLook("cluster", e.target.checked);
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
