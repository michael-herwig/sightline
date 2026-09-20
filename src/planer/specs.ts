// Property tables, filter facets, catalogue tabs and the buying guide.
import { t, tx } from "./i18n";
import { CABLES, catEntry, isHousing, isVendor, productOf } from "./catalogs";
import { condCables, pipeRate } from "./conduit";
import { powerIn } from "./gear";
import type { Ap, Cam, Codecs, InfraItem, Junction, Model, Openness, WhenEntry } from "./types";

/**
 * One row of a property table for a catalogue entry of kind M. `when` leaves the
 * row out entirely — a housing has no PoE budget worth a line.
 */
interface SpecRow<M> {
  k: string;
  v: (m: M) => string;
  /** `na` is "nobody checked" — neither a pass nor a warning, and it says so. */
  g: (m: M) => "ok" | "warn" | "na";
  when?: (m: M) => boolean;
}

/** What a row shows when no data sheet answered the question. */
const UNKNOWN = "—";

// ---------- Openness: can the camera be used without the vendor's console? ----
// A missing field means unverified, not "no" — that is why the grade falls back
// to neutral instead of to a warning. Green needs both halves: a stream you can
// pull (RTSP) and a protocol that discovers and controls it (ONVIF).
export function opennessText(o?: Openness): string {
  if (!o) return UNKNOWN;
  const p: string[] = [];
  if (o.rtsp === true) p.push("RTSP");
  else if (o.rtsp === "via-console") p.push(t("open.console"));
  if (o.onvif) p.push("ONVIF");
  if (o.cloud === "required") p.push(t("open.cloud"));
  if (o.api === "community") p.push(t("open.api.community"));
  return p.length ? p.join(" · ") : t("open.closed");
}

export const opennessGrade = (o?: Openness): "ok" | "warn" | "na" =>
  !o ? "na" : o.rtsp === true && o.onvif === true ? "ok" : "warn";

/** The facet and the hover card ask the same question: open standards, yes or no. */
export const isOpen = (o?: Openness): boolean => !!o && o.rtsp === true && o.onvif === true;

/** Three words for the hover card, where the full sentence would not fit. */
export const opennessShort = (o?: Openness): string =>
  !o
    ? ""
    : isOpen(o)
      ? "ONVIF · RTSP"
      : o.rtsp === true
        ? "RTSP"
        : o.rtsp === "via-console"
          ? t("open.short.console")
          : o.cloud === "required"
            ? t("open.short.cloud")
            : "";

// ---------- Codecs ---------------------------------------------------------
// H.265 halves the bitrate and is what every current camera records in. It is
// also what an older recorder, a browser or a home-automation box may refuse —
// so a main stream that offers nothing else is worth a yellow mark.
const CODEC: Record<string, string> = { h264: "H.264", h265: "H.265" };

const codecList = (v: string[]) => v.map((c) => CODEC[c] || c.toUpperCase()).join(" / ");

export function codecText(c?: Codecs): string {
  if (!c || !c.main.length) return UNKNOWN;
  return c.sub && c.sub.length
    ? `${codecList(c.main)} · Sub ${codecList(c.sub)}`
    : codecList(c.main);
}

export const codecGrade = (c?: Codecs): "ok" | "warn" | "na" =>
  !c || !c.main.length ? "na" : c.main.length === 1 && c.main[0] === "h265" ? "warn" : "ok";

// The fields the rows reach for are optional on the catalogue types (a camera has
// no `ports`), but present on every entry of the kind the row belongs to — that is
// what tests/unit/catalogs.test.ts pins down. Hence the `!` below, never a fallback:
// a fallback would invent a value where the invariant is the thing being relied on.

// ---------- Properties: fixed order, fixed rating ----------
// ok   = meets the planning requirement (green)
// warn = usable, but with a limitation worth knowing (yellow)
export const SPECS: {
  cam: SpecRow<Cam>[];
  ap: SpecRow<Ap>[];
  jb: SpecRow<Junction>[];
  router: SpecRow<InfraItem>[];
  [kind: string]: SpecRow<Model>[];
} = {
  cam: [
    { k: "res", v: (m) => m.res, g: (m) => (/4K/.test(m.res) ? "ok" : "warn") },
    {
      k: "fov",
      v: (m) => (m.fov >= 360 ? t("spec.ptz") : m.fov + "°"),
      g: (m) => (m.fov >= 100 ? "ok" : "warn"),
    },
    { k: "ir", v: (m) => m.ir + " m", g: (m) => (m.ir >= 25 ? "ok" : "warn") },
    { k: "power", v: (m) => tx(m.poe), g: (m) => (m.wifi ? "warn" : "ok") },
    { k: "ip", v: (m) => m.ip, g: (m) => (/IP6[678]/.test(m.ip) ? "ok" : "warn") },
    {
      k: "mount",
      v: (m) => t(m.out ? "spec.outdoor" : "spec.indoor"),
      g: (m) => (m.out ? "ok" : "warn"),
    },
    { k: "openness", v: (m) => opennessText(m.open), g: (m) => opennessGrade(m.open) },
    { k: "codecs", v: (m) => codecText(m.codecs), g: (m) => codecGrade(m.codecs) },
  ],
  ap: [
    { k: "radio", v: (m) => m.wifi!, g: () => "ok" },
    { k: "range", v: (m) => "~" + m.radius + " m", g: (m) => (m.radius >= 30 ? "ok" : "warn") },
    {
      k: "mount",
      v: (m) => t(m.out ? "spec.outdoor" : "spec.indoor"),
      g: (m) => (m.out ? "ok" : "warn"),
    },
    { k: "power", v: (m) => tx(m.poe), g: () => "ok" },
    { k: "ip", v: (m) => m.ip!, g: (m) => (/IP6[5-8]/.test(m.ip!) ? "ok" : "warn") },
  ],
  jb: [
    // On the housing the old line stays; on the device `powerIn` says more than "needs power" ever could.
    {
      k: "power",
      v: (m) => t(m.power ? "spec.needspower" : "spec.passive"),
      g: (m) => (m.power ? "warn" : "ok"),
      when: (m) => m.kind !== "device",
    },
    {
      k: "ground",
      v: (m) => t(m.dig ? "spec.dig.yes" : "spec.dig.no"),
      g: (m) => (m.dig ? "warn" : "ok"),
    },
    { k: "mount", v: (m) => tx(m.mount), g: () => "ok" },
    { k: "ip", v: (m) => m.ip!, g: (m) => (/IP6[5-8]/.test(m.ip!) ? "ok" : "warn") },
    // A power supply wants a mains socket on site — in an underground shaft that's the link.mains finding.
    {
      k: "powerIn",
      v: (m) => t("spec.powerIn." + powerIn(m)),
      g: (m) => (powerIn(m) === "mains" ? "warn" : "ok"),
      when: (m) => m.kind === "device",
    },
    { k: "ports", v: (m) => m.ports + "", g: (m) => (m.ports! >= 4 ? "ok" : "warn") },
    {
      k: "access",
      v: (m) => t(/IP68/.test(m.ip!) ? "spec.dig" : "spec.reachable"),
      g: (m) => (/IP68/.test(m.ip!) ? "warn" : "ok"),
    },
    // Only for devices with power: a shaft has neither an SFP port nor a PoE budget.
    {
      k: "sfp",
      v: (m) => t(m.sfp ? "spec.sfp.yes" : "spec.sfp.no"),
      g: (m) => (m.sfp ? "ok" : "warn"),
      when: (m) => !!m.power,
    },
    {
      k: "poe",
      v: (m) => (m.poe ? m.poe + " W" : t("spec.poe.none")),
      g: (m) => (m.poe! > 0 ? "ok" : "warn"),
      when: (m) => !!m.power,
    },
  ],
  // Router in the hub: LAN ports, LAN-side SFP, PoE output.
  router: [
    { k: "ports", v: (m) => m.ports + "", g: (m) => (m.ports! >= 4 ? "ok" : "warn") },
    {
      k: "sfp",
      v: (m) => t(m.sfp ? "spec.sfp.yes" : "spec.sfp.no"),
      g: (m) => (m.sfp ? "ok" : "warn"),
    },
    {
      k: "poe",
      v: (m) => (m.poe ? m.poe + " W" : t("spec.poe.none")),
      g: (m) => (m.poe! > 0 ? "ok" : "warn"),
    },
  ],
};

/** One filter badge above a catalogue list, tested against an entry of kind M. */
interface Facet<M> {
  id: string;
  group?: string;
  label: string;
  i18n?: boolean;
  test: (m: M) => boolean;
}

/**
 * The one badge that filters nothing. Deprecated products are hidden by the
 * list builders, not by a facet test — this chip only tells them to stop doing
 * that, so it sits in every tab's set and shares one id across all of them.
 */
export const SHOW_DEPRECATED = "dep";

const depFacet: Facet<Model> = {
  id: SHOW_DEPRECATED,
  label: "facet.deprecated",
  i18n: true,
  test: () => true,
};

// Filter badges above the camera catalog. Order is the display order.
export const FACETS: Facet<Cam>[] = [
  { id: "v-ui", group: "vendor", label: "UniFi", test: (m) => isVendor(m, "ubiquiti") },
  { id: "v-reo", group: "vendor", label: "Reolink", test: (m) => isVendor(m, "reolink") },
  { id: "v-net", group: "vendor", label: "Netatmo", test: (m) => isVendor(m, "netatmo") },
  { id: "4k", label: "4K", test: (m) => /4K/.test(m.res) },
  { id: "2k", label: "2K", test: (m) => !/4K/.test(m.res) },
  { id: "af", label: "PoE", test: (m) => /802\.3af/.test(tx(m.poe)) },
  { id: "at", label: "PoE+", test: (m) => /802\.3at/.test(tx(m.poe)) },
  { id: "bt", label: "PoE++", test: (m) => /802\.3bt/.test(tx(m.poe)) },
  { id: "wifi", label: "facet.wifi", i18n: true, test: (m) => !!m.wifi },
  { id: "ir30", label: "facet.ir30", i18n: true, test: (m) => m.ir >= 30 },
  { id: "wide", label: "facet.wide", i18n: true, test: (m) => m.fov >= 180 },
  { id: "camout", label: "facet.outdoor", i18n: true, test: (m) => !!m.out },
  { id: "camin", label: "facet.indoor", i18n: true, test: (m) => !m.out },
  { id: "open", label: "facet.open", i18n: true, test: (m) => isOpen(m.open) },
  depFacet,
];

// Different category, different questions — hence a separate set per tab.
export const FACETS_AP: Facet<Ap>[] = [
  { id: "av-ui", group: "vendor", label: "UniFi", test: (m) => isVendor(m, "ubiquiti") },
  { id: "av-tp", group: "vendor", label: "TP-Link", test: (m) => isVendor(m, "tplink") },
  { id: "av-mt", group: "vendor", label: "MikroTik", test: (m) => isVendor(m, "mikrotik") },
  { id: "av-avm", group: "vendor", label: "AVM FRITZ!", test: (m) => isVendor(m, "avm") },
  { id: "apout", label: "facet.outdoor", i18n: true, test: (m) => !!m.out },
  { id: "apin", label: "facet.indoor", i18n: true, test: (m) => !m.out },
  { id: "ap6", label: "6 GHz", test: (m) => /6 GHz/.test(m.wifi!) },
  { id: "apfar", label: "facet.range30", i18n: true, test: (m) => m.radius >= 30 },
  depFacet,
];

// Housings and devices sit in the same list; the two chips tell them apart.
// "no power" stays alongside it — a surge protector is a device without power.
export const FACETS_JB: Facet<Junction>[] = [
  { id: "jv-ui", group: "vendor", label: "UniFi", test: (m) => isVendor(m, "ubiquiti") },
  { id: "jv-tp", group: "vendor", label: "TP-Link", test: (m) => isVendor(m, "tplink") },
  { id: "jv-mt", group: "vendor", label: "MikroTik", test: (m) => isVendor(m, "mikrotik") },
  { id: "jv-tn", group: "vendor", label: "TRENDnet", test: (m) => isVendor(m, "trendnet") },
  { id: "jv-dg", group: "vendor", label: "DIGITUS", test: (m) => isVendor(m, "digitus") },
  { id: "jbhous", label: "facet.housing", i18n: true, test: (m) => m.kind === "housing" },
  { id: "jbdev", label: "facet.device", i18n: true, test: (m) => m.kind === "device" },
  { id: "jbpas", label: "facet.passive", i18n: true, test: (m) => !m.power },
  { id: "jbsw", label: "facet.switch", i18n: true, test: (m) => !!m.power && m.ports! >= 8 },
  { id: "jbip68", label: "IP68", test: (m) => /IP6[78]/.test(m.ip!) },
  depFacet,
];

// Hub and accessories: only the vendor question, everything else is in the subtitle.
export const FACETS_GEAR: Facet<InfraItem>[] = [
  { id: "gv-ui", group: "vendor", label: "UniFi", test: (m) => isVendor(m, "ubiquiti") },
  { id: "gv-avm", group: "vendor", label: "AVM FRITZ!", test: (m) => isVendor(m, "avm") },
  depFacet,
];

// Indexed by catalogue tab, so the value type stays the loose one — which shape a
// facet tests is decided by the tab, exactly as with CATALOG and catEntry().
export const FACET_SETS: Record<string, Facet<Model>[]> = {
  cam: FACETS,
  ap: FACETS_AP,
  jb: FACETS_JB,
  gear: FACETS_GEAR,
  cond: [],
};

// The catalog is its own ribbon: one category at a time, with its own search.
export const CAT_TABS = [
  { id: "cam", label: "cat.cams", tab: "tab.cat.cam", note: "cat.cams.note", box: "cat-cams" },
  { id: "ap", label: "cat.aps", tab: "tab.cat.ap", note: "cat.aps.note", box: "cat-aps" },
  { id: "jb", label: "cat.jbs", tab: "tab.cat.jb", note: "cat.jbs.note", box: "cat-jbs" },
  { id: "gear", label: "cat.gear", tab: "tab.cat.gear", note: "cat.gear.note", box: "cat-gear" },
  { id: "cond", label: "cat.cond", tab: "tab.cat.cond", note: "cat.cond.note", box: "cat-cond" },
];

// When the model fits, when it doesn't — the sentence you'd otherwise search a
// forum for. For a product it lives in its own file (`useCases` / `caveats` in
// src/catalog/<kind>-<id>/product.json); what stays here are the conduit
// templates, which are recipes rather than products.
const WHEN: Record<string, WhenEntry> = {
  "cond:fiber": {
    de: {
      yes: "Zwischen Gebäuden und über 90 m — potentialfrei, kein Weg für den Blitz.",
      no: "Nicht für die letzten Meter zum Gerät, dort braucht es Kupfer.",
    },
    en: {
      yes: "Between buildings and beyond 90 m — galvanically isolated, no path for lightning.",
      no: "Not for the last metres to a device, that needs copper.",
    },
  },
  "cond:cat": {
    de: {
      yes: "Kurze Wege im Gebäude oder bis 90 m mit Überspannungsschutz an beiden Enden.",
      no: "Nicht ungeschützt zwischen Gebäuden — Blitz und Potentialunterschiede.",
    },
    en: {
      yes: "Short runs inside a building, or up to 90 m with surge protection at both ends.",
      no: "Not unprotected between buildings — lightning and potential differences.",
    },
  },
  "cond:power": {
    de: {
      yes: "Wo Technik Strom braucht: Verteilerkasten, Switch, Torantrieb.",
      no: "Nicht im selben Rohr wie die Datenkabel.",
    },
    en: {
      yes: "Where gear needs power: cabinet, switch, gate drive.",
      no: "Not in the same conduit as the data cables.",
    },
  },
  "cond:pipe": {
    de: {
      yes: "Reserve mitverlegen, solange der Graben offen ist — billiger wird es nie wieder.",
      no: "Nicht als Ersatz für ein Kabel, das jetzt schon gebraucht wird.",
    },
    en: {
      yes: "Lay a spare while the trench is open — it will never be cheaper.",
      no: "Not as a substitute for a cable you already need.",
    },
  },
};

// `gear` is the catalogue tab; in the product directory the head end is `infra`.
export function whenOf(kind: string, key: string): WhenEntry | null {
  const p = productOf(kind === "gear" ? "infra" : kind, key);
  if (p && p.useCases && p.caveats)
    return {
      de: { yes: p.useCases.de, no: p.caveats.de },
      en: { yes: p.useCases.en, no: p.caveats.en },
    };
  return WHEN[kind + ":" + key] || null;
}

// ---------- Metric and groups: one place for select fields and hover card ----------
// What the part provides, in one line: "8× PoE · 52 W", "2× SFP", "IP54 · 6 ports".
// Units (PoE, SFP, W, m) are the same in both languages — only text gets translated.
export function optHint(kind: string, key: string): string {
  const m = catEntry(kind, key);
  if (!m) return "";
  const p: string[] = [];
  if (kind === "cam")
    p.push(m.res, m.fov >= 360 ? "PTZ" : m.fov + "°", "IR " + m.ir + " m", opennessShort(m.open));
  else if (kind === "ap") p.push(m.wifi, "~" + m.radius + " m");
  else if (kind === "cable") p.push(m.m.toFixed(2) + " €/m", m.max ? "max " + m.max + " m" : "");
  else if (kind === "cond") {
    const cabs = condCables(m);
    p.push(
      (pipeRate(m) + cabs.reduce((a, x) => a + CABLES[x.type].m * x.n, 0)).toFixed(2) + " €/m",
    );
    cabs.forEach((x) => p.push(x.n + "× " + tx(CABLES[x.type].name)));
  } else if (kind === "jb" && isHousing(key))
    p.push(m.ip, m.ports ? t("opt.ports", { n: m.ports }) : "");
  else {
    // Device or item from the hub: outputs, SFP slots, PoE budget, range extension.
    // An injector has two jacks but only feeds one — that's what poePorts is for.
    const poe = m.poePorts || ((m.poe || 0) > 0 ? m.ports : 0);
    if (poe) p.push(poe + "× PoE");
    else if (m.ports) p.push(m.power ? m.ports + "× LAN" : t("opt.ports", { n: m.ports }));
    if (m.sfpPorts || m.sfp) p.push((m.sfpPorts || 1) + "× SFP");
    if (m.poe) p.push(m.poe + " W");
    if (m.extend) p.push("+" + m.extend + " m");
  }
  return p.filter(Boolean).join(" · ");
}
