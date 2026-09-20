// WMS base map: tile pyramid, cache, prefetch, overlay and the layer menu.
import type { Show } from "./types";
import { scheduleSave } from "./hooks";
import { t } from "./i18n";
import { GEO, px2e, px2n } from "./geo";
import { drag, state, view } from "./store";
import { $, el, svg } from "./dom";

export const wms = (
  service: string,
  layers: string,
  bbox: string,
  wpx: number,
  hpx: number,
  transparent: boolean,
): string =>
  `https://www.wms.nrw.de/geobasis/${service}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
  `&LAYERS=${layers}&STYLES=&CRS=EPSG:25832&BBOX=${bbox}&WIDTH=${wpx}&HEIGHT=${hpx}` +
  // Aerial imagery as JPEG: a PNG tile weighs a good ten times as much, and noise
  // compresses poorly under PNG anyway. Transparency is only needed for ALKIS.
  `&FORMAT=${transparent ? "image/png&TRANSPARENT=TRUE" : "image/jpeg"}`;

const ALKIS_FULL =
  "adv_alkis_tatsaechliche_nutzung,adv_alkis_gewaesser,adv_alkis_flurstuecke,adv_alkis_gebaeude";

export const ALKIS_LINES = "adv_alkis_flurstuecke,adv_alkis_gebaeude";

interface Basemap {
  label: string;
  service: string;
  layers: string;
}

export const BASEMAPS: Record<string, Basemap> = {
  dop: { label: "layer.dop", service: "wms_nw_dop", layers: "nw_dop_rgb" },
  alkis: { label: "layer.alkis", service: "wms_nw_alkis", layers: ALKIS_FULL },
};

// Tiles instead of a single stretched full image. Two things depend on this:
//  * A tile's BBOX snaps to a fixed grid, so the URL stays identical across
//    pan and zoom — that's what lets the browser's HTTP cache kick in.
//  * When panning, only tiles are added. Nothing gets repositioned,
//    so nothing jumps while the new tile is still loading.
const DPR = Math.min(2, window.devicePixelRatio || 1);

const TILE_PX = Math.round(512 * DPR); // requested at device resolution, otherwise the tile gets blurry when zooming

const BASE_M = 4096; // edge length at zoom level 0, in meters

const MAX_Z = 18;

const TARGET_SCREEN_PX = 512; // target size of a tile on screen → roughly 1:1 pixel

const TILE_BUDGET = 320; // one viewport plus prefetch stock around it

const MAX_PARALLEL = 8; // concurrent requests to the WMS

// One pyramid level: a <g> per zoom, and the tiles placed in it so far.
interface TileEntry {
  img: SVGImageElement;
  ok: boolean;
  seen: number;
}
interface Level {
  g: SVGGElement;
  tiles: Map<string, TileEntry>;
}
interface TileJob {
  img: SVGImageElement;
  url: string;
  cx: number;
  cy: number;
  lv: Level;
  key: string;
}

// Tile loader: every URL is requested exactly once (after that the browser
// cache takes over), at most MAX_PARALLEL requests run at a time, and whoever
// is closest to the center gets served first.
const dispatched = new Set<string>();

const queue: TileJob[] = [];

let inflight = 0;

// The WMS sends no cache headers at all, so the browser reloads every tile
// every time. Hence its own storage: the Cache API for beyond the current
// session, a Map for the running one. The service allows CORS.
const TILE_CACHE = "sl-wms-v1";

const TILE_TTL_MS = 30 * 24 * 3600 * 1000; // aerial imagery gets re-flown on a yearly cycle

const MEM_TILES = 400;

// Blobs live here, not blob: addresses. Previously the LRU released addresses
// that were still attached to a visible tile — the tile then stayed
// empty and the coarser zoom level flashed through underneath.
const memTiles = new Map<string, Blob>(); // URL -> Blob

const tileFails = new Map<string, number>(); // URL -> number of failed attempts

let cachePromise: Promise<Cache | null> | null = null;

function tileStore() {
  if (!cachePromise) {
    cachePromise =
      typeof caches !== "undefined" && caches.open
        ? caches.open(TILE_CACHE).catch(() => null)
        : Promise.resolve(null);
  }
  return cachePromise;
}

function rememberTile(url: string, blob: Blob): Blob {
  memTiles.delete(url);
  memTiles.set(url, blob); // touched again = young again
  if (memTiles.size > MEM_TILES) memTiles.delete(memTiles.keys().next().value as string);
  return blob;
}

async function tileBlob(url: string): Promise<Blob> {
  if (memTiles.has(url)) return rememberTile(url, memTiles.get(url)!);
  if (typeof fetch !== "function") throw new Error("kein fetch");
  const store = await tileStore();
  if (store) {
    const hit = await store.match(url);
    if (hit) {
      const at = +(hit.headers.get("x-cached-at") || 0);
      if (Date.now() - at < TILE_TTL_MS) return rememberTile(url, await hit.blob());
      await store.delete(url); // expired
    }
  }
  // Without a timeout a request hangs forever: inflight never drops back, the
  // queue stalls, and dropStaleLevels(true) is never triggered.
  const signal =
    typeof AbortSignal !== "undefined" && AbortSignal.timeout
      ? AbortSignal.timeout(15000)
      : undefined;
  const res = await fetch(url, signal ? { mode: "cors", signal } : { mode: "cors" });
  if (!res.ok) throw new Error("Kachel " + res.status);
  const blob = await res.blob();
  if (store) {
    try {
      await store.put(
        url,
        new Response(blob, {
          headers: { "content-type": blob.type || "image/jpeg", "x-cached-at": String(Date.now()) },
        }),
      );
    } catch {}
  }
  return rememberTile(url, blob);
}

// Every tile gets its own blob: address and releases it again when
// removed. Its lifetime is thus tied to the element, not to an LRU.
function releaseTile(img: SVGImageElement): void {
  const obj = img.getAttribute("data-obj");
  if (obj) {
    try {
      URL.revokeObjectURL(obj);
    } catch {}
    img.removeAttribute("data-obj");
  }
}

// A tile that drops out of the queue, or whose element is no longer in the
// document, must also drop out of the bookkeeping. Otherwise it stays in
// lv.tiles, applyBasemap() considers it done and never requests it again —
// that spot stays a gray hole forever.
function forgetTile(lv: Level | null, key: string, img: SVGImageElement, url: string | null): void {
  if (url) dispatched.delete(url);
  releaseTile(img);
  img.remove();
  if (lv) lv.tiles.delete(key);
}

function setTileHref(
  img: SVGImageElement,
  url: string,
  lv: Level | null,
  key: string,
): Promise<void> {
  return tileBlob(url).then(
    (blob) => {
      if (!img.isConnected) {
        forgetTile(lv, key, img, null);
        return;
      }
      releaseTile(img);
      // From the cache in under 120 ms: show immediately, otherwise panning looks like loading.
      if (Date.now() - (+(img.dataset.t as string) || 0) < 120) img.classList.add("instant");
      const obj = URL.createObjectURL(blob);
      img.setAttribute("data-obj", obj);
      img.setAttribute("href", obj);
    },
    () => {
      dispatched.delete(url);
      if (img.isConnected) img.setAttribute("href", url);
      else forgetTile(lv, key, img, null);
    },
  );
}

async function clearTileCache(): Promise<void> {
  memTiles.clear();
  dispatched.clear();
  tileFails.clear();
  cachePromise = null;
  try {
    if (typeof caches !== "undefined" && caches.delete) await caches.delete(TILE_CACHE);
  } catch {}
  resetTiles();
}

function queueTile(
  img: SVGImageElement,
  url: string,
  cx: number,
  cy: number,
  lv: Level,
  key: string,
): void {
  img.setAttribute("data-url", url);
  if (dispatched.has(url)) {
    setTileHref(img, url, lv, key);
    return;
  }
  img.dataset.t = String(Date.now());
  queue.push({ img, url, cx, cy, lv, key });
  pump();
}

function pump(): void {
  while (inflight < MAX_PARALLEL && queue.length) {
    // Nobody wants to see what's two viewports old anymore — but it also has to
    // be forgotten, otherwise the tile is never requested again.
    const z = zoomFor(),
      keep = tileRange(z, "view");
    for (let i = queue.length - 1; i >= 0; i--) {
      const j = queue[i],
        [jz, tx, ty] = j.key.split("/").map(Number);
      const away = jz !== z || tx < keep.tx0 || tx > keep.tx1 || ty < keep.ty0 || ty > keep.ty1;
      if (away || !j.img.isConnected) {
        forgetTile(j.lv, j.key, j.img, null);
        queue.splice(i, 1);
      }
    }
    if (!queue.length) break;
    const vx = view.x + view.w / 2,
      vy = view.y + view.h / 2;
    let best = 0,
      bd = Infinity;
    for (let i = 0; i < queue.length; i++) {
      const d = Math.hypot(queue[i].cx - vx, queue[i].cy - vy);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const job = queue.splice(best, 1)[0];
    dispatched.add(job.url);
    inflight++;
    job.img.setAttribute("data-url", job.url);
    // Fetch via the cache; if that fails (no fetch, no CORS, offline),
    // the <image> just loads the address itself. inflight counts requests — it used
    // to hang on the image's load event and got out of step because of that.
    setTileHref(job.img, job.url, job.lv, job.key).then(tileDone, tileDone);
  }
  // Nothing more in flight: whatever isn't loaded now won't load anymore.
  // Only once the images are actually decoded: the load event comes after
  // the address is set, an immediate cleanup released the old level too soon.
  if (!inflight && !queue.length) {
    clearTimeout(forceTimer);
    forceTimer = setTimeout(() => dropStaleLevels(true), 600);
  }
}

function tileDone(): void {
  inflight = Math.max(0, inflight - 1);
  pump();
  pumpWarm();
}

// Prefetch for the neighboring zoom levels: cache only, no <image>. Runs
// only once the visible queue is empty, and never more than two at a time.
const warmQ: string[] = [];
let warming = 0;

function warmTile(url: string): void {
  if (
    memTiles.has(url) ||
    dispatched.has(url) ||
    warmQ.includes(url) ||
    (tileFails.get(url) || 0) >= 3
  )
    return;
  warmQ.push(url);
  pumpWarm();
}

function pumpWarm(): void {
  while (warming < 2 && warmQ.length && !queue.length && inflight === 0) {
    const u = warmQ.shift()!; // guarded by warmQ.length above
    warming++;
    tileBlob(u)
      .catch(() => {
        tileFails.set(u, (tileFails.get(u) || 0) + 1);
      })
      .then(() => {
        warming--;
        pumpWarm();
      });
  }
}

const tileM = (z: number): number => BASE_M / Math.pow(2, z);

function zoomFor(): number {
  const mPerScreenPx = view.w / GEO.pxPerM / Math.max(1, svg.clientWidth);
  // floor instead of round: when in doubt, the larger tile — that's fewer requests.
  const z = Math.floor(Math.log2(BASE_M / (mPerScreenPx * TARGET_SCREEN_PX)));
  return Math.max(0, Math.min(MAX_Z, z));
}

// The browser draws two <image> elements at the same edge both with half
// opacity — a row of background shows through in between, that was the white and
// yellowish seams. Each tile therefore extends a bit past its right and
// bottom edge, so the neighbors overlap.
// The amount is relative to the tile, not absolute: after zoomFor() a tile is
// always 512–1024 screen pixels wide, so w/1024 is roughly half a screen
// pixel. A fixed meter amount would turn into a visible stripe when zooming in
// and double the transparent ALKIS lines; view/clientWidth in turn are 0
// as long as dockview has the map panel detached.
const TILE_SEAM = 1 / 1024;

const tileRect = (z: number, tx: number, ty: number) => {
  const m = tileM(z),
    e = tx * m,
    n = (ty + 1) * m,
    s = m * GEO.pxPerM;
  return {
    x: (e - GEO.e0) * GEO.pxPerM,
    y: (GEO.n0 - n) * GEO.pxPerM,
    w: s * (1 + TILE_SEAM),
    h: s * (1 + TILE_SEAM),
  };
};

const tileBbox = (z: number, tx: number, ty: number): string => {
  const m = tileM(z);
  return [tx * m, ty * m, (tx + 1) * m, (ty + 1) * m].map((v) => v.toFixed(2)).join(",");
};

// pad "view" = one whole viewport in each direction: whoever pans finds the tiles already there.
function tileRange(z: number, pad: number | "view") {
  const m = tileM(z);
  const r = {
    tx0: Math.floor(px2e(view.x) / m),
    tx1: Math.floor(px2e(view.x + view.w) / m),
    ty0: Math.floor(px2n(view.y + view.h) / m),
    ty1: Math.floor(px2n(view.y) / m),
  };
  const px = pad === "view" ? r.tx1 - r.tx0 + 1 : pad || 0,
    py = pad === "view" ? r.ty1 - r.ty0 + 1 : pad || 0;
  return { tx0: r.tx0 - px, tx1: r.tx1 + px, ty0: r.ty0 - py, ty1: r.ty1 + py };
}

// A separate group per zoom level, coarse at the bottom, fine on top. A level is only
// removed once the finer one is actually loaded — otherwise there's a brief flash of nothing.
const levels = new Map<number, Level>();

function levelFor(z: number): Level {
  let lv = levels.get(z);
  if (!lv) {
    // el() returns `any` by design (dom.ts) — the SVG group shape is enforced by Level below.
    const g: SVGGElement = el("g", { "data-z": String(z) }, null);
    const host = $("g-tiles");
    const after = [...host.children].find((c) => +c.getAttribute("data-z") > z);
    host.insertBefore(g, after || null);
    lv = { g, tiles: new Map<string, TileEntry>() };
    levels.set(z, lv);
  }
  return lv;
}

let tileClock = 0;
let forceTimer: ReturnType<typeof setTimeout> | undefined;

function addTile(
  lv: Level,
  service: string,
  layers: string,
  z: number,
  tx: number,
  ty: number,
): TileEntry | null {
  const key = `${z}/${tx}/${ty}`;
  let e2 = lv.tiles.get(key);
  if (!e2) {
    const url0 = wms(service, layers, tileBbox(z, tx, ty), TILE_PX, TILE_PX, false);
    if ((tileFails.get(url0) || 0) >= 3) return null; // three strikes, then give up
    const r = tileRect(z, tx, ty);
    const img: SVGImageElement = el(
      "image",
      {
        x: r.x.toFixed(2),
        y: r.y.toFixed(2),
        width: r.w.toFixed(2),
        height: r.h.toFixed(2),
        preserveAspectRatio: "none",
      },
      lv.g,
    );
    // `entry` (const) instead of reassigning `e2` from inside the closures below:
    // a `let` narrowed to non-undefined right before a closure is defined loses
    // that narrowing inside the closure, `entry` never had the `undefined` case.
    const entry: TileEntry = { img, ok: false, seen: 0 }; // seen is overwritten below before anyone reads it
    e2 = entry;
    img.addEventListener("load", () => {
      entry.ok = true;
      img.classList.add("ok");
      tileFails.delete(img.getAttribute("data-url")!);
      dropStaleLevels();
    });
    // Otherwise a broken tile stays empty forever and keeps the coarser level
    // underneath alive — that's exactly what looked like a "wrong layer".
    img.addEventListener("error", () => {
      const u = img.getAttribute("data-url")!;
      tileFails.set(u, (tileFails.get(u) || 0) + 1);
      dispatched.delete(u);
      releaseTile(img);
      img.remove();
      lv.tiles.delete(key);
      dropStaleLevels();
    });
    lv.tiles.set(key, entry);
    queueTile(img, url0, r.x + r.w / 2, r.y + r.h / 2, lv, key);
  }
  e2.seen = ++tileClock;
  return e2;
}

// A zoom level only drops out once the current one is fully in place — otherwise
// the empty background flashes through briefly while zooming.
function dropStaleLevels(force?: boolean): void {
  const z = zoomFor(),
    cur = levels.get(z);
  if (!cur || !cur.tiles.size) return;
  if (!force) {
    for (const tl of cur.tiles.values()) if (!tl.ok) return;
  }
  // Only remove after fading in — otherwise the background shows through the fade.
  const stale = [...levels.keys()].filter((k) => k !== z);
  if (!stale.length) return;
  setTimeout(() => {
    if (zoomFor() !== z) return; // meanwhile zoomed further: the next round cleans up
    stale.forEach((k) => {
      const lv = levels.get(k);
      if (!lv) return;
      lv.tiles.forEach((tl) => releaseTile(tl.img));
      lv.g.remove();
      levels.delete(k);
    });
  }, 280);
}

function sweepLevel(lv: Level, z: number, pad: number | "view"): void {
  if (lv.tiles.size <= TILE_BUDGET) return;
  const r = tileRange(z, pad);
  [...lv.tiles.entries()]
    .filter(([k]) => {
      const [, tx, ty] = k.split("/").map(Number);
      return tx < r.tx0 || tx > r.tx1 || ty < r.ty0 || ty > r.ty1;
    })
    .sort((a, b) => a[1].seen - b[1].seen)
    .slice(0, lv.tiles.size - TILE_BUDGET)
    .forEach(([k, v]) => {
      releaseTile(v.img);
      v.img.remove();
      lv.tiles.delete(k);
    });
}

const ovLevels = new Map<number, Level>();

function ovLevelFor(z: number): Level {
  let lv = ovLevels.get(z);
  if (!lv) {
    const host = $("g-overlay"),
      g: SVGGElement = el("g", { "data-z": String(z) }, null);
    const after = [...host.children].find((c) => +c.getAttribute("data-z") > z);
    host.insertBefore(g, after || null);
    lv = { g, tiles: new Map<string, TileEntry>() };
    ovLevels.set(z, lv);
  }
  return lv;
}

// Like dropStaleLevels, the overlay also needs an emergency exit: a tile that
// neither loads nor fails (a hanging request) otherwise held the old level
// forever — its parcel lines then sat offset over the new ones.
let ovForceTimer: ReturnType<typeof setTimeout> | undefined;

function dropStaleOv(force?: boolean): void {
  const z = zoomFor(),
    cur = ovLevels.get(z);
  if (!cur || !cur.tiles.size) return;
  if (!force) {
    for (const tl of cur.tiles.values())
      if (!tl.ok) {
        clearTimeout(ovForceTimer);
        ovForceTimer = setTimeout(() => dropStaleOv(true), 3000);
        return;
      }
  }
  clearTimeout(ovForceTimer);
  const stale = [...ovLevels.keys()].filter((k) => k !== z);
  if (!stale.length) return;
  setTimeout(() => {
    if (zoomFor() !== z) return;
    stale.forEach((k) => {
      const lv = ovLevels.get(k);
      if (lv) {
        lv.g.remove();
        ovLevels.delete(k);
      }
    });
  }, 280);
}

export function applyBasemap(pad?: number | "view"): void {
  const key = BASEMAPS[state.basemap] ? state.basemap : "dop";
  state.basemap = key;
  const bm = BASEMAPS[key],
    z = zoomFor();
  const lv = levelFor(z);
  let r = tileRange(z, pad || 0),
    n = (r.tx1 - r.tx0 + 1) * (r.ty1 - r.ty0 + 1);
  if (pad === "view" && n > 240) {
    r = tileRange(z, 1);
    n = (r.tx1 - r.tx0 + 1) * (r.ty1 - r.ty0 + 1);
  } // huge screen: only one tile ring
  if (n <= 240) {
    for (let tx = r.tx0; tx <= r.tx1; tx++)
      for (let ty = r.ty0; ty <= r.ty1; ty++) addTile(lv, bm.service, bm.layers, z, tx, ty);
  }
  sweepLevel(lv, z, "view");
  if (pad === "view") {
    // One level in and one out, only the visible viewport — then zoom finds the tiles ready.
    warmQ.length = 0;
    [z + 1, z - 1]
      .filter((zz) => zz >= 0 && zz <= MAX_Z)
      .forEach((zz) => {
        const rr = tileRange(zz, 0);
        if ((rr.tx1 - rr.tx0 + 1) * (rr.ty1 - rr.ty0 + 1) > 60) return;
        for (let tx = rr.tx0; tx <= rr.tx1; tx++)
          for (let ty = rr.ty0; ty <= rr.ty1; ty++)
            warmTile(wms(bm.service, bm.layers, tileBbox(zz, tx, ty), TILE_PX, TILE_PX, false));
      });
    pumpWarm();
  }
  dropStaleLevels();

  // ALKIS over the aerial imagery: its own small pyramid. Tiles stay in place, a
  // level only drops out once the new one is loaded — otherwise the cadastre flickers.
  const ovOn = !!state.overlay && key !== "alkis";
  $("g-overlay").style.display = ovOn ? "" : "none";
  if (ovOn) {
    const olv = ovLevelFor(z),
      rr = tileRange(z, 0);
    if ((rr.tx1 - rr.tx0 + 1) * (rr.ty1 - rr.ty0 + 1) <= 30) {
      for (let tx = rr.tx0; tx <= rr.tx1; tx++)
        for (let ty = rr.ty0; ty <= rr.ty1; ty++) {
          const k = `${z}/${tx}/${ty}`;
          if (olv.tiles.has(k)) {
            olv.tiles.get(k)!.seen = ++tileClock;
            continue;
          }
          const rect = tileRect(z, tx, ty);
          const img: SVGImageElement = el(
            "image",
            {
              x: rect.x.toFixed(2),
              y: rect.y.toFixed(2),
              width: rect.w.toFixed(2),
              height: rect.h.toFixed(2),
              preserveAspectRatio: "none",
              href: wms("wms_nw_alkis", ALKIS_LINES, tileBbox(z, tx, ty), TILE_PX, TILE_PX, true),
            },
            olv.g,
          );
          const e2: TileEntry = { img, ok: false, seen: ++tileClock };
          img.addEventListener("load", () => {
            e2.ok = true;
            img.classList.add("ok");
            dropStaleOv();
          });
          img.addEventListener("error", () => {
            img.remove();
            olv.tiles.delete(k);
            dropStaleOv();
          });
          olv.tiles.set(k, e2);
        }
    }
    // Limit the prefetch stock: whatever is far outside and hasn't been seen the longest goes.
    if (olv.tiles.size > 40) {
      [...olv.tiles.entries()]
        .filter(([k]) => {
          const [, tx, ty] = k.split("/").map(Number);
          return tx < rr.tx0 - 1 || tx > rr.tx1 + 1 || ty < rr.ty0 - 1 || ty > rr.ty1 + 1;
        })
        .sort((a, b) => a[1].seen - b[1].seen)
        .slice(0, olv.tiles.size - 40)
        .forEach(([k, v]) => {
          v.img.remove();
          olv.tiles.delete(k);
        });
    }
    dropStaleOv();
  }

  $("attrib").hidden = false;
  $("attrib").textContent = t("layer.attrib");
  document
    .querySelectorAll<HTMLElement>("#layerRow [data-bm]")
    .forEach((b) => b.setAttribute("aria-checked", String(b.dataset.bm === key)));
  $("overlayBtn").setAttribute("aria-pressed", String(!!state.overlay));
  $("overlayBtn").disabled = key === "alkis";
}

export function resetTiles(): void {
  levels.forEach((lv) => {
    lv.tiles.forEach((tl) => releaseTile(tl.img));
    lv.g.remove();
  });
  levels.clear();
  $("g-overlay").innerHTML = "";
  ovLevels.clear();
  queue.length = 0;
  warmQ.length = 0;
  inflight = 0;
  tileFails.clear();
  applyBasemap(0);
}

export let booted = false,
  saveTimerView: ReturnType<typeof setTimeout> | undefined,
  tileTimer: ReturnType<typeof setTimeout> | undefined,
  prefetchTimer: ReturnType<typeof setTimeout> | undefined;

export function basemapLater(): void {
  // While dragging: no DOM work and no saving per frame.
  // Both together made panning stutter.
  clearTimeout(tileTimer);
  tileTimer = setTimeout(() => applyBasemap(0), drag ? 300 : 80);
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => applyBasemap("view"), 500);
  if (!booted || drag) return;
  clearTimeout(saveTimerView);
  saveTimerView = setTimeout(scheduleSave, 400);
}

export function fillBasemapSelect(): void {
  document.querySelectorAll<HTMLElement>("#layerRow [data-bm]").forEach((b) => {
    b.setAttribute("aria-checked", String(state.basemap === b.dataset.bm));
    b.onclick = () => {
      if (state.basemap === b.dataset.bm) return;
      state.basemap = b.dataset.bm!; // CSS selector [data-bm] guarantees the attribute is present
      resetTiles();
      scheduleSave();
    };
  });
}

const MENUS: [string, string][] = [
  ["layerMenu", "layerBtn"],
  ["viewMenu2", "viewBtn"],
  ["lookMenu", "lookBtn"],
];

export function closeMapMenus(except?: string): void {
  MENUS.forEach(([m, b]) => {
    if (m === except) return;
    $(m).classList.remove("open");
    $(b).setAttribute("aria-expanded", "false");
  });
}

// What the map shows: cones, rings, conduits, labels — stored per plan.
const SHOW_KEYS: (keyof Show)[] = ["cones", "rings", "conds", "labels", "sections"];

export function applyShow(): void {
  const sh = state.show || {};
  SHOW_KEYS.forEach((k) => {
    const on = sh[k] !== false;
    svg.classList.toggle("hide-" + k, !on);
    const b = document.querySelector(`#showRow [data-show="${k}"]`);
    if (b) b.setAttribute("aria-pressed", String(on));
  });
}

// Written from other modules; ES module bindings are read-only for importers.
export const setBooted = (v: boolean): void => {
  booted = v;
};

export function wireTiles(): void {
  MENUS.forEach(([m, b]) => {
    $(b).onclick = () => {
      const open = !$(m).classList.contains("open");
      closeMapMenus(m);
      $(m).classList.toggle("open", open);
      $(b).setAttribute("aria-expanded", String(open));
    };
  });

  document.querySelectorAll<HTMLElement>("#showRow [data-show]").forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.show as keyof Show; // CSS selector [data-show] guarantees the attribute is present
      state.show = state.show || {};
      state.show[k] = state.show[k] === false;
      applyShow();
      scheduleSave();
    };
  });

  $("overlayBtn").onclick = () => {
    state.overlay = !state.overlay;
    applyBasemap();
    scheduleSave();
  };

  $("cacheClear").onclick = clearTileCache;
}
