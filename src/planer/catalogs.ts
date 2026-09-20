// Everything the planner looks up in a catalogue.
//
// Products — cameras, access points, junction housings and devices, head end and
// accessories — live one folder per product under `src/catalog/`; this module
// only re-exports them, so every existing import keeps working. Prices are in
// those files (`priceDate`, currently 09/2026); nothing here carries a price
// except the metre rates below.
//
// What stays here is what is not a product: conduit and cable rates, the
// templates built from them, the connection types at the head end, and the
// retailer links.
import type { CableSpec, CondTemplate, Item, Model, PipeSpec, Shop, WanSpec } from "./types";
import { APS, CAMS, INFRA, JUNCTIONS } from "../catalog/index";
import { t } from "./i18n";

export { APS, CAMS, INFRA, JUNCTIONS, PRODUCTS, isCurrent, productOf } from "../catalog/index";

// A junction is a location: `model` is the housing, `gear` are the devices inside it.
// The same map carries both; `kind` tells them apart. `power` used to do that —
// which was wrong as soon as a device needs no power: splice box, surge
// protector, SFP module, PoE extender are components, not housings.
export const isHousing = (key: string) => !!JUNCTIONS[key] && JUNCTIONS[key].kind === "housing";

export const isDevice = (key: string) => !!JUNCTIONS[key] && JUNCTIONS[key].kind === "device";

// A conduit is either a **trench** (`kind: "trench"`) — with one to six ducts inside,
// each with **its own type and its own price**, and cables inside the ducts — or a
// **cable run** (`kind: "cable"`): a bundle on a wall, in the basement, across the attic, or
// as an overhead line, with no trench and no duct. That's why duct and cable are separate here:
// a trunk duct can carry two fibre cables that split onto two ducts at the junction
// — nothing gets split (spliced) in the process.
export const PIPES: Record<string, PipeSpec> = {
  dn50: { name: { de: "Leerrohr DN 50", en: "Conduit DN 50" }, m: 1.6 },
  dn63: { name: { de: "Leerrohr DN 63", en: "Conduit DN 63" }, m: 2.2 },
};

export const CABLES: Record<string, CableSpec> = {
  fiber: {
    name: { de: "Glasfaser SM, 4 Fasern", en: "Fibre SM, 4 cores" },
    m: 1.8,
    fixed: 70,
    color: "var(--accent)",
    info: {
      de: "<p><b>Glasfaser Singlemode, 4 Fasern, vorkonfektioniert (LC).</b> Wird als ganzes Kabel durchs Rohr gezogen, an beiden Enden steckt ein SFP-Modul in Switch oder Medienkonverter (die Fixkosten). Länge spielt keine Rolle, Blitz koppelt nicht ein.</p>\n<ul><li>4 Fasern = 2 Verbindungen mit Reserve. Eine Faserpaar je Ziel.</li>\n<li>Nie knicken: Biegeradius mindestens 15× Kabeldurchmesser. Beim Ziehen die Stecker mit Ziehstrumpf schützen.</li>\n<li>Am Abzweig nicht teilen — zwei Ziele heißt zwei Kabel im Stammrohr.</li></ul>",
      en: "<p><b>Single-mode fibre, 4 cores, pre-terminated (LC).</b> Pulled through the pipe as one cable; at both ends an SFP module sits in a switch or media converter (the fixed cost). Length does not matter, lightning does not couple in.</p>\n<ul><li>4 cores = 2 links with a spare. One fibre pair per destination.</li>\n<li>Never kink it: bend radius at least 15× the cable diameter. Protect the connectors with a pulling sock.</li>\n<li>Do not split at a branch — two destinations means two cables in the trunk.</li></ul>",
    },
    note: {
      de: "Vorkonfektioniert LC. Fixkosten je Kabel: 2 SFP-Module. Am Abzweig durchziehen, nicht spleißen.",
      en: "Pre-terminated LC. Fixed cost per cable: 2 SFP modules. Pull it through at a branch, do not splice.",
    },
  },
  cat: {
    name: { de: "Cat6A", en: "Cat6A" },
    m: 0.9,
    fixed: 30,
    max: 90,
    color: "var(--ink-3)",
    info: {
      de: "<p><b>Cat6A, Kupfer.</b> Trägt Daten bis 10 Gbit/s <em>und</em> PoE-Strom im selben Kabel — deshalb das Kabel von Switch zu Kamera oder Access Point.</p>\n<ul><li>Grenze 90 m je Strecke (plus Patchkabel). Darüber: Glasfaser oder ein Switch dazwischen.</li>\n<li>Zwischen Gebäuden koppelt Blitz ein: Überspannungsschutz an beiden Enden (die Fixkosten) — oder gleich Glasfaser.</li>\n<li>Draußen und in Erde nur als Erdkabel-Variante (PE-Mantel, gelfüllt), nicht das Innenkabel.</li></ul>",
      en: "<p><b>Cat6A, copper.</b> Carries data up to 10 Gbit/s <em>and</em> PoE power in the same cable — hence the cable from switch to camera or access point.</p>\n<ul><li>Limit 90 m per run (plus patch cords). Beyond that: fibre or a switch in between.</li>\n<li>Between buildings lightning couples in: surge protection at both ends (the fixed cost) — or fibre from the start.</li>\n<li>Outdoors and buried only as the outdoor variant (PE sheath, gel-filled), not the indoor cable.</li></ul>",
    },
    note: {
      de: "Nur bis 90 m und nur mit Überspannungsschutz an beiden Enden (Fixkosten). Zwischen Gebäuden lieber Glasfaser.",
      en: "Only up to 90 m and only with surge protection at both ends (the fixed cost). Between buildings, prefer fibre.",
    },
  },
  power: {
    name: { de: "NYY-J 5×2,5 mm²", en: "NYY-J 5×2.5 mm²" },
    m: 2.6,
    fixed: 0,
    color: "var(--power)",
    info: {
      de: '<p><b>NYY-J 5×2,5 mm² — das deutsche Standard-Erdkabel für 230/400 V.</b> N = Normleitung, Y = PVC-Isolierung, Y = PVC-Mantel, J = mit grün-gelbem Schutzleiter; fünf Adern à 2,5 mm² (L1, L2, L3, N, PE).</p>\n<p><b>Starkstrom?</b> Ja — NYY ist für 0,6/1 kV ausgelegt, Drehstrom 400 V ist sein Alltag. Die Grenze setzt der Querschnitt, nicht der Kabeltyp:</p>\n<table class="cost"><tr><th>Querschnitt</th><th>Sicherung (Erde, grob)</th><th>reicht für</th></tr>\n<tr><td>5×2,5 mm²</td><td>16–20 A</td><td>Werkstatt: Steckdosen, Licht, kleine Maschinen (~11 kW)</td></tr>\n<tr><td>5×4 mm²</td><td>25 A</td><td>Wallbox 11 kW mit Reserve, längere Wege</td></tr>\n<tr><td>5×6 mm²</td><td>32 A</td><td>Wallbox 22 kW, Stall mit Kompressor oder Heizung</td></tr>\n<tr><td>5×10 mm²</td><td>40–50 A</td><td>Nebengebäude als eigener Unterverteiler</td></tr></table>\n<ul><li>Ab 30–40 m Länge zählt der Spannungsfall: eine Stufe größer wählen.</li>\n<li>Eigenes Rohr oder 20 cm Abstand zu Datenkabeln.</li>\n<li>Auslegung, Anschluss, FI und Abnahme macht der Elektriker — der Preis hier ist nur das Kabel.</li></ul>',
      en: '<p><b>NYY-J 5×2.5 mm² — the standard German buried power cable for 230/400 V.</b> N = standard cable, Y = PVC insulation, Y = PVC sheath, J = with green-yellow protective earth; five cores of 2.5 mm² (L1, L2, L3, N, PE).</p>\n<p><b>Three-phase?</b> Yes — NYY is rated 0.6/1 kV, 400 V three-phase is its everyday job. The cross-section sets the limit, not the cable type:</p>\n<table class="cost"><tr><th>Cross-section</th><th>Fuse (buried, rough)</th><th>enough for</th></tr>\n<tr><td>5×2.5 mm²</td><td>16–20 A</td><td>Workshop: sockets, light, small machines (~11 kW)</td></tr>\n<tr><td>5×4 mm²</td><td>25 A</td><td>11 kW wallbox with headroom, longer runs</td></tr>\n<tr><td>5×6 mm²</td><td>32 A</td><td>22 kW wallbox, stable with compressor or heating</td></tr>\n<tr><td>5×10 mm²</td><td>40–50 A</td><td>Outbuilding as its own sub-distribution</td></tr></table>\n<ul><li>From 30–40 m of length voltage drop matters: go one size up.</li>\n<li>Own pipe or 20 cm distance from data cables.</li>\n<li>Sizing, connection, RCD and sign-off are the electrician’s job — the price here is the cable only.</li></ul>',
    },
    note: {
      de: "Erdkabel. Anschluss, FI und Abnahme durch den Elektriker, nicht enthalten.",
      en: "Buried cable. Connection, RCD and sign-off by an electrician, not included.",
    },
  },
};

// Fixed order light → copper → power. It decides how cables are named,
// drawn, and sorted in the cross-section.
export const CABLE_ORDER = ["fiber", "cat", "power"];

// The buttons in the catalog are just templates. After that, every conduit can be
// filled in individually: duct type, ducts in the trench, and per duct the cables inside.
export const CONDUITS: Record<string, CondTemplate> = {
  fiber: {
    kind: "trench",
    name: { de: "Leerrohr DN 50 + Glasfaser", en: "Conduit DN 50 + fibre" },
    ducts: [{ pipe: "dn50", cables: [{ type: "fiber", n: 1 }] }],
  },
  cat: {
    kind: "trench",
    name: { de: "Leerrohr DN 50 + Cat6A", en: "Conduit DN 50 + Cat6A" },
    ducts: [{ pipe: "dn50", cables: [{ type: "cat", n: 1 }] }],
  },
  power: {
    kind: "trench",
    name: { de: "Stromrohr DN 63 + NYY-J", en: "Power conduit DN 63 + NYY-J" },
    ducts: [{ pipe: "dn63", cables: [{ type: "power", n: 1 }] }],
  },
  pipe: {
    kind: "trench",
    name: { de: "Nur Leerrohr (Reserve)", en: "Empty conduit (spare)" },
    ducts: [{ pipe: "dn50", cables: [] }],
  },
  // Cable run: on the wall, in the basement, across the attic, as an overhead line — no trench,
  // no duct, but several cables may share the same bundle.
  cable: {
    kind: "cable",
    name: { de: "Kabel Cat6A (ohne Rohr)", en: "Cat6A cable (no conduit)" },
    ducts: [{ cables: [{ type: "cat", n: 1 }] }],
  },
  "cable-fiber": {
    kind: "cable",
    name: { de: "Glasfaser (ohne Rohr)", en: "Fibre cable (no conduit)" },
    ducts: [{ cables: [{ type: "fiber", n: 1 }] }],
  },
};

// Product link: `url` in the catalog is the verified path in the UniFi EU store.
// If missing (shaft, duct, small parts), only the retailer search remains.
const UI_STORE = "https://eu.store.ui.com/eu/en/category/";

// Third-party manufacturers carry an absolute address; only UniFi paths get completed.
export const productUrl = (m: Model) =>
  m && m.url ? (/^https?:/.test(m.url) ? m.url : UI_STORE + m.url) : null;

// Amazon sits next to the manufacturer page. Where no original item is listed,
// the title says so — otherwise someone might buy the wrong thing in good faith.
export const amazonLabel = (m: Model) =>
  t(m && m.amazonSimilar ? "product.amazon.similar" : "product.amazon");

// "Amazon" in the retailer list leads straight to the verified item if the catalog
// knows one — otherwise to search. A separate button next to it was one too many.
export const shopHref = (sh: Shop, name: string, amazon?: string) =>
  sh.label === "Amazon" && amazon ? amazon : sh.url(name);

export const vendorOf = (m: Model): string => (m && m.vendor) || "ubiquiti";

export const VENDORS: Record<string, string> = {
  ubiquiti: "UniFi",
  reolink: "Reolink",
  netatmo: "Netatmo",
  tplink: "TP-Link",
  mikrotik: "MikroTik",
  avm: "AVM FRITZ!",
  trendnet: "TRENDnet",
  digitus: "DIGITUS",
};

// "any" = manufacturer-neutral (shaft, box, cabinet): passes through every manufacturer filter.
export const isVendor = (m: Model, v: string) => vendorOf(m) === v || m.vendor === "any";

export const SHOPS: Shop[] = [
  { label: "Geizhals", url: (q: string) => "https://geizhals.de/?fs=" + encodeURIComponent(q) },
  {
    label: "Idealo",
    url: (q: string) =>
      "https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=" +
      encodeURIComponent(q),
  },
  { label: "Amazon", url: (q: string) => "https://www.amazon.de/s?k=" + encodeURIComponent(q) },
  {
    label: "eBay",
    url: (q: string) => "https://www.ebay.de/sch/i.html?_nkw=" + encodeURIComponent(q),
  },
  {
    label: "Kleinanzeigen",
    url: (q: string) =>
      "https://www.kleinanzeigen.de/s-suchanfrage.html?keywords=" + encodeURIComponent(q),
  },
];

export const imgUrl = (kind: string, key: string, m?: Model) =>
  (m && m.img) || "/products/" + kind + "-" + key + ".jpg";

// Loose on purpose: the element kind decides which of the three shapes comes
// back, and every caller already branches on it.
export const CATALOG: Record<string, Record<string, Model>> = { cam: CAMS, ap: APS, jb: JUNCTIONS };

// A house node is the connection to the network. The speed depends on the
// connection type, hence the tiers sit directly on the type.
export const WAN: Record<string, WanSpec> = {
  dsl: { name: { de: "DSL", en: "DSL" }, speeds: [10, 15, 25, 50] },
  fiber: { name: { de: "Glasfaser", en: "Fibre" }, speeds: [100, 200, 400, 600, 1000] },
};

export const wanOf = (it: Item) => {
  const w: Partial<NonNullable<Item["wan"]>> = it.wan || {};
  const type = w.type && WAN[w.type] ? w.type : "dsl";
  const speeds = WAN[type].speeds;
  const speed = Number(w.speed);
  return { type, speed: speeds.includes(speed) ? speed : speeds[speeds.length - 1] };
};

export const KIND_PREFIX: Record<string, string> = { cam: "K", ap: "A", jb: "J", hub: "H" };

export function modelOf(it: Item): Model {
  const c = CATALOG[it.kind];
  return c && c[it.model as string];
}

// One datasheet for everything: camera, access point, housing, device, item from the
// hub, and cable. Every ⓘ in the app goes through here — name, properties,
// full text and, where there's something to buy, the product box.
export const catEntry = (kind: string, key: string): Model =>
  kind === "gear"
    ? INFRA.find((x) => x.id === key)
    : kind === "cable"
      ? CABLES[key]
      : kind === "cond"
        ? CONDUITS[key]
        : (CATALOG[kind] || {})[key];
