// Hover between list and map, and the small hover card.
import { tx } from "./i18n";
import { CABLES, catEntry, imgUrl } from "./catalogs";
import { condCables } from "./conduit";
import { optHint } from "./specs";
import { drag, mode, state } from "./store";
import { linkText, links } from "./links";
import { $, esc, gCond, gMark } from "./dom";

// Hover links the list and the map (see setHover() further below). renderMap() resets
// the key because the highlighted nodes disappear in the process.
export let hoverKey = "";

// ---------- Hover card: the short version, one node, no state ----------
// It appears after a short delay over anything carrying a data-hover="<kind>:<key>"
// attribute: catalog cards, device and cable rows, selection fields. Image, name, price, one
// line of stats, two sentences — datasheet, product link and buying advice stay in the ⓘ dialog.
// 150 ms is short enough that the card feels attached to the pointer. Within half a
// second of the last one closing there is no wait at all: moving from a row to the
// next row, or from one marker to the next, switches the card instead of restarting it.
const HOVER_WAIT = 150,
  HOVER_WARM = 500,
  HOVER_CHARS = 220;

let hoverTimer: ReturnType<typeof setTimeout> | undefined,
  hoverNode: Element | null = null,
  warmUntil = 0;

function hideHover() {
  clearTimeout(hoverTimer);
  hoverNode = null;
  const n = $("hovercard");
  if (n && !n.hidden) {
    n.hidden = true;
    warmUntil = Date.now() + HOVER_WARM;
  }
}

/** Dragging, placing and drawing want the map free — no card in the way. */
const busy = () => !!drag || mode !== "select";

// An element on the map is not a catalogue row: its own label and connection
// status go on top, the card of the model it carries below. A head end has no
// single model, so there only the head remains.
function itemHead(id: string) {
  const it = state.items.find((i) => i.id === id);
  if (!it) return null;
  const st = links().status.get(it.id);
  return {
    it,
    html:
      `<div class="hh"><span class="hn">${esc(it.label)}</span></div>` +
      (st ? `<div class="hs ${st.g === "ok" ? "ok" : "warn"}">${esc(linkText(st))}</div>` : ""),
  };
}

function showHover(kind: string, key: string, anchor: Element | null) {
  const n = $("hovercard");
  if (!n || !anchor || !anchor.isConnected) return;
  const head = kind === "item" ? itemHead(key) : null;
  if (kind === "item") {
    if (!head) return;
    kind = head.it.kind === "hub" ? "" : head.it.kind;
    key = head.it.model || "";
  }
  const m = kind && key ? catEntry(kind, key) : null;
  if (!m && !head) return;
  let body = "";
  if (m) {
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
    body =
      (shot ? `<img src="${esc(shot)}" alt="" loading="lazy" onerror="this.remove()">` : "") +
      `<div class="hh"><span class="hn">${esc(tx(m.name))}</span>` +
      (m.price != null ? `<span class="hp">${m.price} €</span>` : "") +
      `</div>` +
      (hint ? `<div class="hk">${esc(hint)}</div>` : "") +
      (note ? `<div class="hd">${esc(note)}</div>` : "");
  }
  n.innerHTML = (head ? head.html : "") + body;
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
// `s`: any — an <input>/<select>/<button> depending on the call site (catalog field,
// device row, cable row); same DOM-plumbing ambiguity dom.ts's $() is `any` for.
export function hoverSel(s: any, kind: string) {
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
function hoverAt(target: Element | null): string {
  const n =
    target &&
    target.closest &&
    target.closest(".lrow[data-sk], [data-goto], #g-markers .marker, #g-conduits g.conduit");
  if (!n) return "";
  const nd = n as HTMLElement; // .lrow/.marker/.conduit: HTML or SVG, both carry dataset
  if (nd.dataset && nd.dataset.sk) return nd.dataset.sk;
  if (nd.getAttribute("data-goto")) return nd.getAttribute("data-goto")!;
  const id = nd.getAttribute("data-id");
  if (id) return (nd.classList.contains("conduit") ? "conduit:" : "item:") + id;
  // A cluster stands in for its members — it can only be highlighted as a whole.
  return "";
}

function setHover(key: string) {
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
export const setHoverKey = (v: string) => {
  hoverKey = v;
};

export function wireHover() {
  {
    // On a touch device there's no hover — the ⓘ is enough there.
    const coarse = () =>
      typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    const over = (e: MouseEvent) => {
      const t = e.target as Element | null;
      const a = t && t.closest && t.closest("[data-hover]");
      if (a === hoverNode) return;
      hideHover();
      if (!a || coarse() || busy()) return;
      hoverNode = a;
      const v = a.getAttribute("data-hover")!, // guaranteed by the [data-hover] selector above
        i = v.indexOf(":");
      const wait = Date.now() < warmUntil ? 0 : HOVER_WAIT;
      hoverTimer = setTimeout(() => showHover(v.slice(0, i), v.slice(i + 1), a), wait);
    };
    // mouseenter doesn't bubble, but still reaches the document in the capture phase.
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseenter", over, true);
    document.addEventListener("mouseout", (e) => {
      if (hoverNode && !hoverNode.contains(e.relatedTarget as Node | null)) hideHover();
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

  document.addEventListener("mouseover", (e) => setHover(hoverAt(e.target as Element | null)));

  document.addEventListener("mouseout", (e) => {
    if (!hoverAt(e.relatedTarget as Element | null)) setHover("");
  });
}
