// Nominatim address search, jumping to a place, seeding a fresh plan.
import type { Item } from "./types";
import { scheduleSave } from "./hooks";
import { t } from "./i18n";
import { GEO, UTM, e2px, geoAround, n2px, px2e, px2n, stampGeo, useGeo } from "./geo";
import { nextLabel, state, uid, view } from "./store";
import { $, applyName, esc, h, setStatus } from "./dom";
import { changed, histInit } from "./history";
import { select } from "./modes";
import { syncAspect } from "./view";
import { resetTiles } from "./tiles";
import { applyView, fit, jumpView } from "./render";

// The Nominatim search/reverse result shape, trimmed to the fields this file reads.
interface NominatimHit {
  lat: string;
  lon: string;
  display_name?: string;
  address?: {
    road?: string;
    house_number?: string;
    postcode?: string;
    village?: string;
    town?: string;
    city?: string;
    hamlet?: string;
    suburb?: string;
  };
}

// ALKIS answers GetFeatureInfo and allows CORS. This lets us query the
// parcel under a point without a key and without a second service.
export async function parcelAt(x: number, y: number) {
  const e = px2e(x),
    n = px2n(y),
    d = 20;
  const url =
    "https://www.wms.nrw.de/geobasis/wms_nw_alkis?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo" +
    "&LAYERS=adv_alkis_flurstuecke&QUERY_LAYERS=adv_alkis_flurstuecke&STYLES=&CRS=EPSG:25832" +
    `&BBOX=${(e - d).toFixed(2)},${(n - d).toFixed(2)},${(e + d).toFixed(2)},${(n + d).toFixed(2)}` +
    "&WIDTH=200&HEIGHT=200&I=100&J=100&INFO_FORMAT=text/html&FORMAT=image/png";
  const r = await fetch(url);
  if (!r.ok) throw new Error("alkis " + r.status);
  const doc2 = new DOMParser().parseFromString(await r.text(), "text/html");
  const cells = [...doc2.querySelectorAll("td")].map((td) =>
    td.textContent!.replace(/\s+/g, " ").trim(),
  );
  const after = (label: string) => {
    const i = cells.findIndex((c) => c.toLowerCase().startsWith(label));
    return i >= 0 ? (cells[i + 1] || "").trim() : "";
  };
  // Identifier: 6 district + 3 section + 5 numerator + 4 denominator, right-padded with _
  const kz = after("flurstückskennzeichen");
  const zaehler = kz.length >= 14 ? String(+kz.slice(9, 14)) : "";
  const nenner = kz.length > 14 ? kz.slice(14).replace(/_/g, "") : "";
  return {
    parcel: zaehler ? (nenner ? `${zaehler}/${+nenner}` : zaehler) : "",
    flur: after("flur:").replace(/^0+/, ""),
    gemarkung: after("gemarkung:"),
    gemeinde: after("gemeinde:"),
  };
}

const NOMINATIM = "https://nominatim.openstreetmap.org";

export async function geoLookup(q: string): Promise<NominatimHit[]> {
  const r = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`, {
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error("geo " + r.status);
  return r.json();
}

export async function geoReverse(lat: number, lon: number): Promise<NominatimHit> {
  const r = await fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lon}`, {
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error("geo " + r.status);
  return r.json();
}

export function shortAddress(d: NominatimHit): string {
  const a: NonNullable<NominatimHit["address"]> = (d && d.address) || {};
  const street = [a.road, a.house_number].filter(Boolean).join(" ");
  const place = [a.postcode, a.village || a.town || a.city || a.hamlet || a.suburb]
    .filter(Boolean)
    .join(" ");
  return [street, place].filter(Boolean).join(", ") || (d && d.display_name) || "";
}

// Jump to a point: roughly 150 m edge length, that's property scale.
export function gotoLatLon(lat: number, lon: number, span?: number) {
  const u = UTM.fwd(lat, lon);
  const w = (span || 150) * GEO.pxPerM;
  view.w = w;
  view.x = e2px(u.e) - w / 2;
  syncAspect();
  view.y = n2px(u.n) - view.h / 2;
  applyView();
}

export const shortPlace = (hit: NominatimHit): string =>
  (hit.display_name || "")
    .split(",")
    .slice(0, 2)
    .map((x) => x.trim())
    .join(" ");

// A freshly created plan gets its house connection right away: viewport,
// marker, plan name, address, and parcel — everything that follows from the hit.
export async function seedFromPlace(place: { lat: number; lon: number; label: string }) {
  const u = UTM.fwd(place.lat, place.lon);
  state.geo = geoAround(u.e, u.n);
  useGeo(state.geo);
  resetTiles();
  gotoLatLon(place.lat, place.lon, 150);
  const cx = view.x + view.w / 2,
    cy = view.y + view.h / 2;
  const hub: Item = {
    id: uid(),
    kind: "hub",
    label: nextLabel("H"),
    x: +cx.toFixed(1),
    y: +cy.toFixed(1),
    note: "",
    wan: { type: "fiber", speed: 1000 },
  };
  state.items.push(hub);
  if (place.label) state.name = place.label;
  select({ kind: "item", id: hub.id });
  try {
    const a = shortAddress(await geoReverse(place.lat, place.lon));
    if (a) {
      hub.note = a;
      if (!(state.name || "").trim()) state.name = a;
    }
  } catch {}
  try {
    const pc = await parcelAt(hub.x, hub.y);
    if (pc.parcel) {
      const ort = [
        pc.gemarkung,
        pc.gemeinde && pc.gemeinde !== pc.gemarkung ? `(${pc.gemeinde})` : "",
      ]
        .filter(Boolean)
        .join(" ");
      state.sub = t("sub.parcel", { parcel: pc.parcel, flur: pc.flur, ort });
    }
  } catch {}
  applyName();
  histInit();
  changed();
}

function geoClose() {
  const l = $("geoList");
  if (l) {
    l.hidden = true;
    l.innerHTML = "";
  }
}

// A plan from before state.geo carries pixels tied to an origin that no longer exists.
// But the house node knows its address: the origin gets recomputed from that.
export async function migrateLegacyGeo() {
  const hub = state.items.find((i) => i.kind === "hub" && (i.note || "").trim());
  if (!hub) return false;
  try {
    const hits = await geoLookup(hub.note!); // guaranteed non-empty by the find() predicate above
    if (!hits || !hits.length) return false;
    const u = UTM.fwd(+hits[0].lat, +hits[0].lon);
    state.geo = {
      e0: +(u.e - hub.x / GEO.pxPerM).toFixed(2),
      n0: +(u.n + hub.y / GEO.pxPerM).toFixed(2),
    };
    useGeo(state.geo);
    stampGeo(state);
    resetTiles();
    fit();
    scheduleSave();
    setStatus(t("geo.migrated"));
    return true;
  } catch {
    return false;
  }
}

export function wireGeosearch() {
  {
    const box = $("geoQ"),
      list = $("geoList");
    let geoTimer: ReturnType<typeof setTimeout> | undefined,
      geoSeq = 0;
    const show = (html: string) => {
      list.innerHTML = html;
      list.hidden = false;
    };
    box.oninput = () => {
      clearTimeout(geoTimer);
      const q = box.value.trim();
      if (q.length < 3) {
        geoClose();
        return;
      }
      geoTimer = setTimeout(async () => {
        const mine = ++geoSeq;
        show(`<div class="cred">${esc(t("geo.busy"))}</div>`);
        let hits: NominatimHit[] = [];
        try {
          hits = await geoLookup(q);
        } catch {
          if (mine === geoSeq) show(`<div class="cred">${esc(t("geo.failed"))}</div>`);
          return;
        }
        if (mine !== geoSeq) return;
        if (!hits.length) {
          show(`<div class="cred">${esc(t("geo.none"))}</div>`);
          return;
        }
        list.innerHTML = "";
        list.hidden = false;
        hits.forEach((hit) => {
          const b = h(`<button type="button">${esc(hit.display_name)}</button>`)
            .firstElementChild as HTMLElement;
          b.onclick = () => {
            jumpView(() => gotoLatLon(+hit.lat, +hit.lon));
            geoClose();
            box.blur();
          };
          list.appendChild(b);
        });
        list.appendChild(h(`<div class="cred">${esc(t("geo.cred"))}</div>`).firstElementChild);
      }, 450); // Nominatim doesn't like keystrokes as requests
    };
    box.onkeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        geoClose();
        box.blur();
      }
    };
    document.addEventListener("pointerdown", (e) => {
      const tgt = e.target as Element; // same access pattern as before, just aliased for the cast
      if (!tgt.closest || !tgt.closest(".geo")) geoClose();
    });
  }
}
