// @ts-nocheck
// Hover between list and map, and the small hover card.
import { tx } from "./i18n";
import { CABLES, catEntry, imgUrl } from "./catalogs";
import { condCables } from "./conduit";
import { optHint } from "./specs";
import { $, esc, gCond, gMark } from "./dom";

// Hover links the list and the map (see setHover() further below). renderMap() resets
// the key because the highlighted nodes disappear in the process.
export let hoverKey = "";

// ---------- Hover card: the short version, one node, no state ----------
// It appears after a short delay over anything carrying a data-hover="<kind>:<key>"
// attribute: catalog cards, device and cable rows, selection fields. Image, name, price, one
// line of stats, two sentences — datasheet, product link and buying advice stay in the ⓘ dialog.
const HOVER_WAIT = 350,
  HOVER_CHARS = 220;

let hoverTimer = null,
  hoverNode = null;

function hideHover() {
  clearTimeout(hoverTimer);
  hoverNode = null;
  const n = $("hovercard");
  if (n) n.hidden = true;
}

function showHover(kind, key, anchor) {
  const m = catEntry(kind, key),
    n = $("hovercard");
  if (!m || !n || !anchor || !anchor.isConnected) return;
  // A conduit template has no text of its own — then the cable inside it speaks.
  const lead = kind === "cond" ? condCables(m)[0] : null;
  let note = String(
    tx(m.note) || tx(m.use) || tx(m.sub) || (lead ? tx(CABLES[lead.type].note) : "") || "",
  )
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (note.length > HOVER_CHARS) note = note.slice(0, HOVER_CHARS).replace(/\s\S*$/, "") + " …";
  const hint = optHint(kind, key);
  // Without a price and without a catalog image there's no product photo — then the placeholder stays off.
  const shot = m.img || m.price ? imgUrl(kind, key, m) : "";
  n.innerHTML =
    (shot ? `<img src="${esc(shot)}" alt="" loading="lazy" onerror="this.remove()">` : "") +
    `<div class="hh"><span class="hn">${esc(tx(m.name))}</span>` +
    (m.price != null ? `<span class="hp">${m.price} €</span>` : "") +
    `</div>` +
    (hint ? `<div class="hk">${esc(hint)}</div>` : "") +
    (note ? `<div class="hd">${esc(note)}</div>` : "");
  n.hidden = false;
  // Next to the trigger, but kept inside the viewport: to the right, otherwise to the left.
  const a = anchor.getBoundingClientRect(),
    b = n.getBoundingClientRect(),
    pad = 8;
  let x = a.right + pad;
  if (x + b.width > innerWidth - pad) x = a.left - pad - b.width;
  n.style.left = Math.max(pad, Math.min(x, innerWidth - pad - b.width)) + "px";
  n.style.top = Math.max(pad, Math.min(a.top, innerHeight - pad - b.height)) + "px";
}

// An <option> has no hover. So the card attaches to the field and shows what's selected.
export function hoverSel(s, kind) {
  if (!s) return;
  const set = () => s.setAttribute("data-hover", kind + ":" + s.value);
  set();
  s.addEventListener("change", () => {
    set();
    const n = $("hovercard");
    if (n && !n.hidden) showHover(kind, s.value, s);
  });
}

// Hover links list and map in both directions: a class, no state,
// no renderMap(). If the map redraws, the hover is gone — that's fine.
// mouseover/mouseout instead of mouseenter/mouseleave, because both sides use delegation.
function hoverAt(target) {
  const n =
    target &&
    target.closest &&
    target.closest(".lrow[data-sk], [data-goto], #g-markers .marker, #g-conduits g.conduit");
  if (!n) return "";
  if (n.dataset && n.dataset.sk) return n.dataset.sk;
  if (n.getAttribute("data-goto")) return n.getAttribute("data-goto");
  const id = n.getAttribute("data-id");
  if (id) return (n.classList.contains("conduit") ? "conduit:" : "item:") + id;
  // A cluster stands in for its members — it can only be highlighted as a whole.
  return "";
}

function setHover(key) {
  if (key === hoverKey) return;
  hoverKey = key;
  document
    .querySelectorAll(".lrow.hover, .marker.hover, .conduit.hover")
    .forEach((n) => n.classList.remove("hover"));
  if (!key) return;
  const i = key.indexOf(":"),
    kind = key.slice(0, i),
    id = key.slice(i + 1);
  document.querySelectorAll(`.lrow[data-sk="${key}"]`).forEach((n) => n.classList.add("hover"));
  const node =
    kind === "conduit"
      ? gCond.querySelector(`g.conduit[data-id="${id}"]`)
      : gMark.querySelector(`.marker[data-id="${id}"]`) ||
        gMark.querySelector(`.cluster[data-ids~="${id}"]`);
  if (node) node.classList.add("hover");
}

// Written from other modules; ES module bindings are read-only for importers.
export const setHoverKey = (v) => {
  hoverKey = v;
};

export function wireHover() {
  {
    // On a touch device there's no hover — the ⓘ is enough there.
    const coarse = () =>
      typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    const over = (e) => {
      const a = e.target.closest && e.target.closest("[data-hover]");
      if (a === hoverNode) return;
      hideHover();
      if (!a || coarse()) return;
      hoverNode = a;
      const v = a.getAttribute("data-hover"),
        i = v.indexOf(":");
      hoverTimer = setTimeout(() => showHover(v.slice(0, i), v.slice(i + 1), a), HOVER_WAIT);
    };
    // mouseenter doesn't bubble, but still reaches the document in the capture phase.
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseenter", over, true);
    document.addEventListener("mouseout", (e) => {
      if (hoverNode && !hoverNode.contains(e.relatedTarget)) hideHover();
    });
    document.addEventListener(
      "mouseleave",
      (e) => {
        if (e.target === hoverNode) hideHover();
      },
      true,
    );
    ["pointerdown", "wheel", "scroll"].forEach((k) =>
      document.addEventListener(k, hideHover, true),
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") hideHover();
      },
      true,
    );
  }

  document.addEventListener("mouseover", (e) => setHover(hoverAt(e.target)));

  document.addEventListener("mouseout", (e) => {
    if (!hoverAt(e.relatedTarget)) setHover("");
  });
}
