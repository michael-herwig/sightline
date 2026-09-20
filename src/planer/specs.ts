// Property tables, filter facets, catalogue tabs and the buying guide.
import { t, tx } from "./i18n";
import { CABLES, catEntry, isHousing, isVendor } from "./catalogs";
import { condCables, pipeRate } from "./conduit";
import { powerIn } from "./gear";
import type { Ap, Cam, InfraItem, Junction, Model, WhenEntry } from "./types";

/**
 * One row of a property table for a catalogue entry of kind M. `when` leaves the
 * row out entirely — a housing has no PoE budget worth a line.
 */
interface SpecRow<M> {
  k: string;
  v: (m: M) => string;
  g: (m: M) => "ok" | "warn";
  when?: (m: M) => boolean;
}

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
];

// Hub and accessories: only the vendor question, everything else is in the subtitle.
export const FACETS_GEAR: Facet<InfraItem>[] = [
  { id: "gv-ui", group: "vendor", label: "UniFi", test: (m) => isVendor(m, "ubiquiti") },
  { id: "gv-avm", group: "vendor", label: "AVM FRITZ!", test: (m) => isVendor(m, "avm") },
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

// When the model fits, when it doesn't — the sentence you'd otherwise search a forum for.
// Kept separate from the catalog so the datasheets stay readable.
const WHEN: Record<string, WhenEntry> = {
  "cam:g6-bullet": {
    de: {
      yes: "Der Standardfall außen: Zufahrt, Hofseite, Stallwand. 30 m Nachtsicht decken die meisten Wege ab.",
      no: "Nicht in engen Innenräumen — sie trägt zu weit und sieht zu schmal.",
    },
    en: {
      yes: "The outdoor default: driveway, yard side, stable wall. 30 m of night vision covers most paths.",
      no: "Not for tight indoor rooms — it reaches too far and sees too narrow.",
    },
  },
  "cam:g6-turret": {
    de: {
      yes: "Flach an der Wand oder unter dem Vordach, wo eine Bullet zu sperrig wäre.",
      no: "Nicht für weite Strecken bei Nacht.",
    },
    en: {
      yes: "Flat on a wall or under an eave, where a bullet would be too bulky.",
      no: "Not for long distances at night.",
    },
  },
  "cam:g6-dome": {
    de: {
      yes: "Innen an der Decke, unauffällig und vandalismusfest.",
      no: "Nicht ungeschützt an der Fassade und nicht auf Distanz.",
    },
    en: {
      yes: "Indoors on the ceiling, discreet and vandal resistant.",
      no: "Not unprotected on a façade and not at a distance.",
    },
  },
  "cam:g6-180": {
    de: {
      yes: "Eine Ecke, zwei Seiten: Hof und Teich mit einem Gerät statt zwei.",
      no: "Nicht für Kennzeichen oder Gesichter — die Auflösung verteilt sich auf 180°.",
    },
    en: {
      yes: "One corner, two sides: yard and pond with one device instead of two.",
      no: "Not for plates or faces — the resolution spreads across 180°.",
    },
  },
  "cam:g6-ptz": {
    de: {
      yes: "Große Fläche, die man im Zweifel heranholen will.",
      no: "Nicht als einzige Kamera: wo sie gerade nicht hinsieht, nimmt sie nichts auf.",
    },
    en: {
      yes: "A large area you may want to zoom into.",
      no: "Not as your only camera: wherever it is not looking, nothing is recorded.",
    },
  },
  "cam:g6-pro-bullet": {
    de: {
      yes: "Weite Strecken und Kennzeichen — größerer Sensor, mehr Reichweite bei Nacht.",
      no: "Nicht für kurze Wege, dort tut es die G6 Bullet zum halben Preis.",
    },
    en: {
      yes: "Long distances and number plates — bigger sensor, more reach at night.",
      no: "Not for short paths, the G6 Bullet does that at half the price.",
    },
  },
  "cam:g5-bullet": {
    de: {
      yes: "Wenn der Preis zählt und 2K für den Überblick reichen.",
      no: "Nicht dort, wo später Gesichter oder Kennzeichen erkennbar sein müssen.",
    },
    en: {
      yes: "When price matters and 2K is enough for an overview.",
      no: "Not where faces or plates have to be readable later.",
    },
  },
  "cam:g5-turret-ultra": {
    de: {
      yes: "Innen, kurze Distanz, kleines Budget — zum Beispiel die Stallgasse.",
      no: "Nicht außen an der Fassade und nicht über 15 m.",
    },
    en: {
      yes: "Indoors, short range, small budget — the stable aisle for instance.",
      no: "Not outdoors on a façade and not beyond 15 m.",
    },
  },
  "cam:g6-instant": {
    de: {
      yes: "Nur da, wo wirklich kein Kabel hinkommt.",
      no: "Nicht im Dauerbetrieb draußen: WLAN-abhängig, 6 m IR, eigenes Netzteil nötig.",
    },
    en: {
      yes: "Only where a cable genuinely cannot reach.",
      no: "Not for permanent outdoor duty: Wi-Fi dependent, 6 m IR, needs its own power supply.",
    },
  },
  "cam:reolink-rlc-810a": {
    de: {
      yes: "Wo eine G6 Bullet zu teuer ist: Einfahrt, Grenze, Stallwand — dieselbe Aufgabe für die Hälfte.",
      no: "Nicht, wenn alles in Protect mit Smart Detection laufen soll — per ONVIF kommt nur das Bild.",
    },
    en: {
      yes: "Where a G6 Bullet is too dear: driveway, boundary, stable wall — the same job for half the price.",
      no: "Not if everything should run in Protect with smart detection — over ONVIF you only get the picture.",
    },
  },
  "cam:reolink-rlc-820a": {
    de: {
      yes: "Unter Vordach oder Decke, unauffällig.",
      no: "Nicht freistehend in Sonne und Regen — die Kuppel spiegelt und verschmutzt.",
    },
    en: {
      yes: "Under eaves or a ceiling, unobtrusive.",
      no: "Not freestanding in sun and rain — the dome reflects and gets dirty.",
    },
  },
  "cam:reolink-rlc-842a": {
    de: {
      yes: "Zufahrt oder Tor, wo Kennzeichen lesbar sein sollen: auf das Tor zoomen.",
      no: "Nicht für Übersicht — eingezoomt wird das Feld eng.",
    },
    en: {
      yes: "Driveway or gate where plates should be readable: zoom onto the gate.",
      no: "Not for overview — zoomed in, the field gets narrow.",
    },
  },
  "cam:reolink-duo-3-poe": {
    de: {
      yes: "Lange Grundstücksgrenze, breite Hofseite: eine Kamera statt zwei.",
      no: "Nicht zur Identifikation auf Distanz — 180° verteilen die Pixel.",
    },
    en: {
      yes: "Long boundary, wide yard side: one camera instead of two.",
      no: "Not for identification at distance — 180° spreads the pixels thin.",
    },
  },
  "cam:reolink-trackmix-poe": {
    de: {
      yes: "Einfahrt mit langem Weg: Übersicht und Tele zugleich, folgt dem Auto.",
      no: "Nicht an engen Stellen — das Tele bringt dort nichts.",
    },
    en: {
      yes: "Driveway with a long approach: overview and tele at once, follows the car.",
      no: "Not in tight spots — the tele adds nothing there.",
    },
  },
  "cam:reolink-rlc-823s2": {
    de: {
      yes: "Weite Fläche, ein Gerät, das nachschaut: Hof, Weide, Feldweg.",
      no: "Nicht als einzige Kamera: sie sieht nur dorthin, wo sie gerade steht. Braucht PoE+.",
    },
    en: {
      yes: "Wide area, one device that goes and looks: yard, paddock, track.",
      no: "Not as the only camera: it only sees where it happens to point. Needs PoE+.",
    },
  },
  "cam:reolink-rlc-810wa": {
    de: {
      yes: "Gartenhaus oder Nebeneingang, wo kein Cat hinkommt, aber eine Steckdose ist.",
      no: "Nicht, wo das WLAN schwach ist — dann fällt sie aus, wenn es zählt.",
    },
    en: {
      yes: "Garden shed or side entrance where no Cat cable reaches but a socket exists.",
      no: "Not where Wi-Fi is weak — it drops out exactly when it matters.",
    },
  },
  "cam:reolink-rlc-520a": {
    de: {
      yes: "Nebeneingang, Garage, Werkstatt: günstige Kontrolle auf kurze Distanz.",
      no: "Nicht zur Identifikation: 5 MP und 80° reichen nur für die Nähe.",
    },
    en: {
      yes: "Side door, garage, workshop: cheap coverage at short range.",
      no: "Not for identification: 5 MP and 80° only work up close.",
    },
  },
  "cam:netatmo-outdoor": {
    de: {
      yes: "Ein einzelnes Gerät an Haustür oder Einfahrt, das eine Außenleuchte ersetzt — App statt NVR.",
      no: "Nicht als Teil eines Kamerasystems: kein ONVIF, keine NVR-Aufzeichnung, braucht 230 V.",
    },
    en: {
      yes: "A single device at the front door or driveway that replaces an outdoor light — app instead of NVR.",
      no: "Not as part of a camera system: no ONVIF, no NVR recording, needs mains.",
    },
  },
  "cam:netatmo-indoor": {
    de: {
      yes: "Flur oder Wohnraum mit Gesichtserkennung und Privatsphärenblende.",
      no: "Nicht außen, nicht im NVR, keine nennenswerte Nachtsicht-Reichweite.",
    },
    en: {
      yes: "Hallway or living room with face recognition and a privacy shutter.",
      no: "Not outdoors, not in an NVR, no real night-vision range.",
    },
  },
  "ap:u7-lite": {
    de: {
      yes: "Ein kleiner Innenraum, Grundversorgung.",
      no: "Nicht für ein ganzes Haus und nicht draußen.",
    },
    en: {
      yes: "One small indoor room, basic coverage.",
      no: "Not for a whole house and not outdoors.",
    },
  },
  "ap:u7-pro": {
    de: {
      yes: "Der Standard fürs Wohnhaus, auch bei vielen Geräten.",
      no: "Nicht außen — IP20, er verträgt keinen Regen.",
    },
    en: {
      yes: "The default for the house, also with many devices.",
      no: "Not outdoors — IP20, it does not take rain.",
    },
  },
  "ap:u7-outdoor": {
    de: {
      yes: "Hof, Weide, Stallvorplatz — IP67 und rundum.",
      no: "Nicht wenn eine Seite gezielt weit abgedeckt werden soll.",
    },
    en: {
      yes: "Yard, paddock, stable forecourt — IP67 and all round.",
      no: "Not when one side needs to be covered far and on purpose.",
    },
  },
  "ap:u7-pro-outdoor": {
    de: {
      yes: "Wenn eine Richtung weit reichen muss, etwa über die Wiese.",
      no: "Nicht als Rundum-AP mitten im Hof.",
    },
    en: {
      yes: "When one direction has to reach far, across the meadow say.",
      no: "Not as an all-round AP in the middle of the yard.",
    },
  },
  "ap:u6-plus": {
    de: {
      yes: "Ein Zimmer oder ein kleines Nebengebäude innen, ohne WiFi 7 zu brauchen.",
      no: "Nicht draußen und nicht für viele Geräte.",
    },
    en: {
      yes: "One room or a small outbuilding indoors, no need for Wi-Fi 7.",
      no: "Not outdoors and not for many devices.",
    },
  },
  "ap:u6-enterprise": {
    de: {
      yes: "Haupthaus mit vielen Geräten, Homeoffice, 6-GHz-Clients.",
      no: "Nicht für kleine Räume oder außen — Geld für Reichweite bringt es nicht.",
    },
    en: {
      yes: "Main house with many devices, home office, 6 GHz clients.",
      no: "Not for small rooms or outdoors — money spent on density, not range.",
    },
  },
  "ap:u6-iw": {
    de: {
      yes: "Ein Zimmer mit Netzwerkdose, das nebenbei vier Kabelports braucht.",
      no: "Nicht als Flächen-AP — die Antenne sitzt in der Wand.",
    },
    en: {
      yes: "A room with a network outlet that also needs four wired ports.",
      no: "Not as an area AP — the antenna sits in the wall.",
    },
  },
  "ap:u7-pro-wall": {
    de: {
      yes: "Wo keine Deckenmontage geht, aber WiFi 7 gewünscht ist.",
      no: "Nicht draußen; für ein ganzes Haus lieber Pro an der Decke.",
    },
    en: {
      yes: "Where ceiling mounting is impossible but Wi-Fi 7 is wanted.",
      no: "Not outdoors; for a whole house use a Pro on the ceiling.",
    },
  },
  "ap:omada-eap610": {
    de: {
      yes: "Preiswerte Grundversorgung je Etage, wenn kein UniFi im Haus ist.",
      no: "Nicht gemischt mit UniFi-APs — zwei Controller, zwei Apps.",
    },
    en: {
      yes: "Cheap baseline per floor when there is no UniFi in the house.",
      no: "Not mixed with UniFi APs — two controllers, two apps.",
    },
  },
  "ap:omada-eap773": {
    de: {
      yes: "Haupthaus mit Omada, wenn WiFi 7 und 6 GHz gewünscht sind.",
      no: "Nicht draußen, und der 10-GbE-Port bringt nur mit passendem Switch etwas.",
    },
    en: {
      yes: "Main house on Omada when Wi-Fi 7 and 6 GHz are wanted.",
      no: "Not outdoors, and the 10 GbE port only helps with a matching switch.",
    },
  },
  "ap:omada-eap650-outdoor": {
    de: {
      yes: "Hofseite oder Nebengebäude mit Omada.",
      no: "Nicht innen — dort sind Deckenmodelle besser und billiger.",
    },
    en: {
      yes: "Yard side or outbuilding on Omada.",
      no: "Not indoors — ceiling models are better and cheaper there.",
    },
  },
  "ap:omada-eap625-outdoor-hd": {
    de: {
      yes: "Stall, Waschplatz, Staub und Nässe — wo IP67 nicht reicht.",
      no: "Nicht für maximale Reichweite; Vorteil ist die Dichtheit.",
    },
    en: {
      yes: "Stable, wash bay, dust and wet — where IP67 is not enough.",
      no: "Not for maximum range; the advantage is the sealing.",
    },
  },
  "ap:mikrotik-cap-ax": {
    de: {
      yes: "Wer RouterOS kennt und am AP noch eine Kamera durchschleifen will.",
      no: "Nicht für Einsteiger — die Oberfläche ist Technikerkost.",
    },
    en: {
      yes: "For RouterOS users who want to pass PoE through to a camera at the AP.",
      no: "Not for beginners — the interface is for technicians.",
    },
  },
  "ap:mikrotik-wap-ax": {
    de: {
      yes: "Günstigster Außen-AP, wenn RouterOS keine Hürde ist.",
      no: "Nicht bei Dauerregen ungeschützt — IP54 ist spritzwasser, nicht Strahlwasser.",
    },
    en: {
      yes: "Cheapest outdoor AP if RouterOS is no hurdle.",
      no: "Not unprotected in constant rain — IP54 is splash, not jet.",
    },
  },
  "jb:usw-ultra-60w": {
    de: {
      yes: "Ein Nebengebäude mit zwei, drei Kameras und einem AP.",
      no: "Nicht ohne Medienkonverter an der Faser, und nicht für PoE++-Geräte.",
    },
    en: {
      yes: "An outbuilding with two or three cameras and an AP.",
      no: "Not on fibre without a media converter, and not for PoE++ devices.",
    },
  },
  "jb:usw-lite-16-poe": {
    de: {
      yes: "Werkstatt oder Stall mit vielen Dosen und wenigen PoE-Geräten.",
      no: "Nicht für acht Kameras — 45 W reichen für drei, vier.",
    },
    en: {
      yes: "Workshop or stable with many outlets and few PoE devices.",
      no: "Not for eight cameras — 45 W covers three or four.",
    },
  },
  "jb:usw-industrial": {
    de: {
      yes: "Stall oder Werkstatt mit Staub und Temperaturen, PTZ oder Flutlicht am Port.",
      no: "Nicht im Wohnhaus — dafür ist er dreimal zu teuer.",
    },
    en: {
      yes: "Stable or workshop with dust and temperature swings, PTZ or floodlights on the ports.",
      no: "Not in the house — three times too expensive for that.",
    },
  },
  "jb:omada-sg2008p": {
    de: {
      yes: "Nebengebäude mit bis zu vier PoE-Geräten, Omada-Umfeld.",
      no: "Nicht für mehr als vier PoE-Ports — nur die Hälfte liefert Strom.",
    },
    en: {
      yes: "Outbuilding with up to four PoE devices, Omada setup.",
      no: "Not for more than four PoE ports — only half of them power.",
    },
  },
  "jb:omada-sg2210mp": {
    de: {
      yes: "Das Faserende mit vielen Kameras — SFP rein, acht PoE-Ports raus, ein Gerät.",
      no: "Nicht für 2,5 GbE oder PoE++.",
    },
    en: {
      yes: "The fibre end with many cameras — SFP in, eight PoE ports out, one box.",
      no: "Not for 2.5 GbE or PoE++.",
    },
  },
  "jb:omada-sg3210xhp-m2": {
    de: {
      yes: "Großes Nebengebäude mit acht Kameras und WiFi-7-AP, 10G-Faser.",
      no: "Nicht für drei Kameras — der Preis lohnt erst mit vielen Ports in Betrieb.",
    },
    en: {
      yes: "Large outbuilding with eight cameras and a Wi-Fi 7 AP, 10G fibre.",
      no: "Not for three cameras — the price only pays off with many ports in use.",
    },
  },
  "jb:tplink-mc220l": {
    de: {
      yes: "Vor jedem Switch ohne SFP-Port, oder für genau ein Gerät mit eigenem Netzteil.",
      no: "Nicht direkt an eine PoE-Kamera — er liefert keinen Strom.",
    },
    en: {
      yes: "Ahead of any switch without an SFP port, or for exactly one device with its own power supply.",
      no: "Not straight into a PoE camera — it supplies no power.",
    },
  },
  "jb:mikrotik-css610": {
    de: {
      yes: "Faserende mit vielen Kameras zum kleinen Preis, wenn keine Controller-Welt nötig ist.",
      no: "Nicht, wenn alles in einer App (UniFi, Omada) sitzen soll.",
    },
    en: {
      yes: "A fibre end with many cameras at a low price when no controller ecosystem is needed.",
      no: "Not if everything is supposed to live in one app (UniFi, Omada).",
    },
  },
  "ap:fritz-repeater-1200-ax": {
    de: {
      yes: "Ein Zimmer mit Netzwerkdose und FRITZ!Box im Haus — günstig und ohne Controller.",
      no: "Nicht ohne Steckdose, nicht draußen, kein PoE.",
    },
    en: {
      yes: "One room with a network outlet and a FRITZ!Box in the house — cheap, no controller.",
      no: "Not without a socket, not outdoors, no PoE.",
    },
  },
  "ap:fritz-repeater-3000-ax": {
    de: {
      yes: "Wohnbereich mit vielen Geräten in einer FRITZ!-Umgebung.",
      no: "Nicht draußen und nicht, wenn PoE-APs an einem Switch geplant sind.",
    },
    en: {
      yes: "Living area with many devices in a FRITZ! setup.",
      no: "Not outdoors, and not if PoE APs on a switch are planned.",
    },
  },
  "ap:fritz-repeater-6000": {
    de: {
      yes: "Großer Raum oder Werkstatt mit FRITZ!Box, wenn 4×4 und 2,5 GbE gewünscht sind.",
      no: "Nicht draußen; für den Preis gibt es PoE-APs mit Controller.",
    },
    en: {
      yes: "Large room or workshop with a FRITZ!Box when 4×4 and 2.5 GbE are wanted.",
      no: "Not outdoors; for the money there are PoE APs with a controller.",
    },
  },
  "jb:shaft": {
    de: {
      yes: "Der Normalfall, wo Rohre zusammenlaufen und man später noch drankommen will.",
      no: "Nicht wo der Deckel stört oder kein Bagger hinkommt.",
    },
    en: {
      yes: "The normal case where conduits meet and you want access later.",
      no: "Not where the lid is in the way or no digger can reach.",
    },
  },
  "jb:box": {
    de: {
      yes: "Ein Abzweig, der sich sicher nie ändert, und das Budget ist knapp.",
      no: "Nicht wo später nachgezogen wird — Öffnen heißt aufgraben.",
    },
    en: {
      yes: "A branch that will never change, on a tight budget.",
      no: "Not where cables get added later — opening it means digging.",
    },
  },
  "jb:cab": {
    de: {
      yes: "Abzweig über Grund, wenn dort auch Technik oder Überspannungsschutz sitzen soll.",
      no: "Nicht mitten auf der Wiese — er braucht Wand oder Sockel.",
    },
    en: {
      yes: "A branch above ground, when gear or surge protection goes there too.",
      no: "Not in the middle of a meadow — it needs a wall or a pedestal.",
    },
  },
  "jb:splice": {
    de: {
      yes: "Nur wenn eine vorhandene Faser wirklich getrennt und neu aufgelegt werden muss.",
      no: "Nicht für einen normalen Abzweig — dort zieht man das zweite Kabel einfach durch.",
    },
    en: {
      yes: "Only when an existing fibre really has to be cut and re-terminated.",
      no: "Not for a normal branch — there you simply pull the second cable through.",
    },
  },
  "jb:flex": {
    de: {
      yes: "Am Faserende in jedem Gebäude: Uplink rein, Kameras und APs daran.",
      no: "Nicht draußen ohne Kasten — IP20 und er braucht Strom.",
    },
    en: {
      yes: "At the end of the fibre in every building: uplink in, cameras and APs on it.",
      no: "Not outdoors without a cabinet — IP20 and it needs power.",
    },
  },
  "jb:lite8": {
    de: {
      yes: "Günstiger Switch, wenn die Zuleitung ohnehin Cat6A ist.",
      no: "Nicht am Glasfaserende — er hat keinen SFP-Anschluss.",
    },
    en: {
      yes: "A cheap switch when the feed is Cat6A anyway.",
      no: "Not at the end of a fibre — it has no SFP port.",
    },
  },
  "jb:conv": {
    de: {
      yes: "Genau ein Gerät am Faserende, etwa ein einzelner AP am Mast.",
      no: "Nicht wenn dort später mehr als ein Gerät hängen soll.",
    },
    en: {
      yes: "Exactly one device at the end of a fibre, a single AP on a pole say.",
      no: "Not when more than one device will hang there later.",
    },
  },
  "jb:shaft-s": {
    de: {
      yes: "Ein kleiner Abzweig mit höchstens zwei, drei dünnen Rohren.",
      no: "Nicht wenn später mehr Rohre dazukommen — dafür ist der große Schacht da.",
    },
    en: {
      yes: "A small branch with at most two or three thin conduits.",
      no: "Not if more conduits get added later — the larger shaft is there for that.",
    },
  },
  "jb:pit": {
    de: {
      yes: "Ein Abzweig, der unter einer befahrenen Zufahrt liegen muss.",
      no: "Nicht im Rasen oder Beet — dort reicht der einfache Kabelschacht.",
    },
    en: {
      yes: "A branch that has to sit under a driveway that gets driven over.",
      no: "Not in a lawn or flower bed — the plain cable shaft does that.",
    },
  },
  "jb:cab-l": {
    de: {
      yes: "Abzweig über Grund mit Switch, Überspannungsschutz und PoE-Injektor zusammen.",
      no: "Nicht für einen einfachen Durchgangs-Abzweig — dafür reicht der kleine Verteilerkasten.",
    },
    en: {
      yes: "A branch above ground with a switch, surge protector and PoE injector together.",
      no: "Not for a simple pass-through branch — the small cabinet covers that.",
    },
  },
  "jb:cab-sw": {
    de: {
      yes: "Ein kleiner Switch draußen an Wand oder Mast, ohne eigenes Außengehäuse.",
      no: "Nicht für einen 8- oder 16-Port-Switch — dafür ist er zu klein.",
    },
    en: {
      yes: "A small switch outdoors on a wall or pole, without an outdoor housing of its own.",
      no: "Not for an 8- or 16-port switch — too small for that.",
    },
  },
  "jb:rack19": {
    de: {
      yes: "Die Zentrale im Haus, wenn Switch, Patchfeld und Router zusammen verkabelt stehen sollen.",
      no: "Nicht draußen — IP20; für ein einzelnes Gerät reicht ein Brett an der Wand.",
    },
    en: {
      yes: "The hub inside the house, when switch, patch panel and router should be wired together.",
      no: "Not outdoors — IP20; a single device is fine on a plain wall shelf.",
    },
  },
  "jb:usw-flex": {
    de: {
      yes: "Zwei, drei Kameras oder ein AP draußen am Mast, ohne Platz für einen Kasten.",
      no: "Nicht am Faserende ohne Medienkonverter, und nicht für PoE++-Geräte.",
    },
    en: {
      yes: "Two or three cameras or an AP outdoors on a pole, with no room for a box.",
      no: "Not at a fibre end without a media converter, and not for PoE++ devices.",
    },
  },
  "jb:tplink-poe170s": {
    de: {
      yes: "Genau ein PoE-Gerät an einem Switch, der selbst kein PoE hat.",
      no: "Nicht für mehrere Geräte — dafür lieber gleich einen PoE-Switch.",
    },
    en: {
      yes: "Exactly one PoE device on a switch that has no PoE of its own.",
      no: "Not for several devices — a PoE switch is the better fix then.",
    },
  },
  "jb:trendnet-tpe-e100": {
    de: {
      yes: "Eine Kamera oder ein AP liegt mehr als 100 m vom Switch entfernt und Glasfaser ist keine Option.",
      no: "Nicht statt Glasfaser planen, wenn ohnehin gegraben wird.",
    },
    en: {
      yes: "A camera or AP sits more than 100 m from the switch and fibre is not an option.",
      no: "Not instead of fibre when digging is happening anyway.",
    },
  },
  "jb:eth-sp-g2": {
    de: {
      yes: "Vor jeder Kamera und jedem AP am Ende einer langen Außenstrecke, wegen Blitzeinschlag in der Nähe.",
      no: "Nicht als Ersatz für eine Erdung — er leitet nur ab, wohin er verbunden ist.",
    },
    en: {
      yes: "Ahead of every camera and AP at the end of a long outdoor run, against a nearby lightning strike.",
      no: "Not a substitute for grounding — it only shunts to where it is connected.",
    },
  },
  "jb:tplink-sm311ls": {
    de: {
      yes: "Ein Switch mit SFP-Schacht soll direkt an die Glasfaser, ohne Medienkonverter.",
      no: "Nicht einzeln bestellen — ohne das Gegenstück am anderen Ende bleibt die Faser dunkel.",
    },
    en: {
      yes: "A switch with an SFP cage should go straight onto the fibre, no media converter.",
      no: "Not ordered alone — without its counterpart at the far end the fibre stays dark.",
    },
  },
  "jb:mikrotik-crs305": {
    de: {
      yes: "Mehrere Gebäude, jedes mit eigener Faser zum Haupthaus, sollen an einem Punkt zusammenlaufen.",
      no: "Nicht wenn dort auch Kupfergeräte mit PoE hängen sollen — er liefert selbst kein PoE.",
    },
    en: {
      yes: "Several buildings, each with its own fibre to the main house, need to come together at one point.",
      no: "Not when copper devices with PoE hang off it too — it supplies no PoE itself.",
    },
  },
  "jb:mikrotik-css610-8g": {
    de: {
      yes: "Zwei Fasern laufen an einem Punkt zusammen und die Geräte dahinter haben eigene Netzteile.",
      no: "Nicht für Kameras oder APs — er liefert kein PoE.",
    },
    en: {
      yes: "Two fibres meet at one point and the devices behind it have their own power supplies.",
      no: "Not for cameras or APs — it hands out no PoE.",
    },
  },
  "jb:usw-flex-mini": {
    de: {
      yes: "Zwei, drei Netzwerkports in einem Kasten ohne Steckdose, gespeist über das PoE-Kabel.",
      no: "Nicht für Kameras — er reicht kein PoE weiter.",
    },
    en: {
      yes: "Two or three network ports in a box with no outlet, fed over the PoE cable.",
      no: "Not for cameras — it passes no PoE on.",
    },
  },
  "jb:usw-flex-xg": {
    de: {
      yes: "Mehrere 10G-Ports ohne Steckdose, etwa am Rekorder im Rack.",
      no: "Nicht als gewöhnlicher Verteiler — für Gigabit ist der Flex Mini ein Zehntel so teuer.",
    },
    en: {
      yes: "Several 10G ports with no outlet, at the recorder in the rack say.",
      no: "Not as an ordinary fan-out — for gigabit the Flex Mini costs a tenth.",
    },
  },
  "jb:u-poe-plus-plus": {
    de: {
      yes: "Ein einzelnes PoE++-Gerät an einem Switch, dessen Budget nicht reicht.",
      no: "Nicht für mehrere Geräte — dafür lieber ein Switch mit größerem Budget.",
    },
    en: {
      yes: "A single PoE++ device on a switch whose budget falls short.",
      no: "Not for several devices — a switch with a bigger budget is the better fix.",
    },
  },
  "jb:tplink-poe380s": {
    de: {
      yes: "Eine PTZ-Kamera oder ein Gerät mit Heizung, das mehr als 60 W zieht.",
      no: "Nicht wenn 60 W reichen — der POE170S kostet die Hälfte.",
    },
    en: {
      yes: "A PTZ camera or a device with a heater that draws more than 60 W.",
      no: "Not when 60 W is enough — the POE170S costs half.",
    },
  },
  "jb:trendnet-ti-pg541i": {
    de: {
      yes: "Schaltschrank in Werkstatt oder Stall, wo der Switch auf die Hutschiene soll.",
      no: "Nicht im Wohnhaus — dort tut ein gewöhnlicher Switch dasselbe für weniger.",
    },
    en: {
      yes: "A cabinet in a workshop or stable where the switch goes on a DIN rail.",
      no: "Not in the house — an ordinary switch does the same for less there.",
    },
  },
  "jb:trendnet-ti-pg102i": {
    de: {
      yes: "Acht PoE-Geräte aus einem Schaltschrank, mit Reserve im Budget.",
      no: "Nicht für vier Kameras — dafür reicht der TI-PG541i.",
    },
    en: {
      yes: "Eight PoE devices from one cabinet, with headroom in the budget.",
      no: "Not for four cameras — the TI-PG541i covers that.",
    },
  },
  "jb:tplink-sm321a": {
    de: {
      yes: "Das Leerrohr gibt nur eine Faser her und beide Enden bekommen ein Modul.",
      no: "Nicht ohne das Gegenstück SM321B am anderen Ende — allein bleibt die Strecke dunkel.",
    },
    en: {
      yes: "The conduit yields only one fibre strand and both ends get a module.",
      no: "Not without its SM321B counterpart at the far end — alone the run stays dark.",
    },
  },
  "jb:tplink-sm321b": {
    de: {
      yes: "Das andere Ende derselben Faser, immer zusammen mit dem SM321A.",
      no: "Nicht zweimal dasselbe Modul bestellen — A und B gehören paarweise.",
    },
    en: {
      yes: "The far end of the same fibre, always together with the SM321A.",
      no: "Not two of the same module — A and B belong in pairs.",
    },
  },
  "gear:ucg": {
    de: {
      yes: "Ein Gerät für alles: Router, Controller und Aufzeichnung, wenn die Kameras von UniFi kommen.",
      no: "Nicht bei DSL-Zwang mit Telefonie — und nicht für mehr als rund fünf 4K-Kameras ohne UNVR.",
    },
    en: {
      yes: "One box for everything: router, controller and recording, when the cameras are UniFi.",
      no: "Not where DSL with telephony is mandatory — and not for more than about five 4K cameras without a UNVR.",
    },
  },
  "gear:fb7690": {
    de: {
      yes: "DSL-Anschluss mit Telefonie, und die Kameras zeichnen auf einem UNVR auf.",
      no: "Nicht als Kamera-Zentrale — sie nimmt nichts auf.",
    },
    en: {
      yes: "A DSL line with telephony, with the cameras recording on a UNVR.",
      no: "Not as the camera head end — it records nothing.",
    },
  },
  "gear:fb5690": {
    de: {
      yes: "Ein Anschluss, der heute DSL ist und morgen Glasfaser sein kann.",
      no: "Nicht, wenn ein UniFi-Gateway ohnehin Router und Rekorder stellt.",
    },
    en: {
      yes: "A line that is DSL today and may be fibre tomorrow.",
      no: "Not when a UniFi gateway is already the router and recorder.",
    },
  },
  "gear:fb5590": {
    de: {
      yes: "Glasfaseranschluss, bei dem das SFP-Modul des Anbieters direkt in den Router soll.",
      no: "Nicht bei DSL, und nicht als Rekorder.",
    },
    en: {
      yes: "A fibre line where the provider's SFP module should plug straight into the router.",
      no: "Not for DSL, and not as a recorder.",
    },
  },
  "gear:fb5530": {
    de: {
      yes: "Glasfaser im kleinen Haushalt, wenn WiFi 6 und wenige Ports reichen.",
      no: "Nicht bei vielen Kabelgeräten — die Anschlüsse werden knapp.",
    },
    en: {
      yes: "Fibre in a small household when Wi-Fi 6 and a few ports are enough.",
      no: "Not with many wired devices — the ports run out.",
    },
  },
  "gear:fb6690": {
    de: {
      yes: "Kabelanschluss (Vodafone, PŸUR): der Router spricht DOCSIS direkt.",
      no: "Nicht bei DSL oder Glasfaser, und nicht als Rekorder.",
    },
    en: {
      yes: "A cable line (Vodafone, PŸUR): the router speaks DOCSIS directly.",
      no: "Not for DSL or fibre, and not as a recorder.",
    },
  },
  "gear:nvme": {
    de: {
      yes: "Pflicht, sobald das UCG Fiber aufzeichnen soll.",
      no: "Nicht nötig, wenn ein UNVR mit Festplatten die Aufnahme übernimmt.",
    },
    en: {
      yes: "Mandatory as soon as the UCG Fiber is meant to record.",
      no: "Not needed when a UNVR with drives does the recording.",
    },
  },
  "gear:unvr": {
    de: {
      yes: "Ab etwa sechs 4K-Kameras, bei langer Vorhaltezeit oder wenn der Router kein UniFi-Gateway ist.",
      no: "Nicht bei drei Kameras am UCG Fiber — das kann es selbst.",
    },
    en: {
      yes: "From about six 4K cameras, with long retention, or when the router is not a UniFi gateway.",
      no: "Not for three cameras on a UCG Fiber — it handles those itself.",
    },
  },
  "gear:hdd": {
    de: {
      yes: "Für jeden UNVR: Menge nach Kameras und Vorhaltezeit wählen, lieber eine Nummer größer.",
      no: "Keine Desktop-Platte einbauen — Dauerschreiben killt sie.",
    },
    en: {
      yes: "For every UNVR: size it by cameras and retention, and go one size up.",
      no: "Do not fit a desktop drive — continuous writing kills it.",
    },
  },
  "gear:misc": {
    de: {
      yes: "Immer mitrechnen: Dosen, Einführungen und Überspannungsschutz tauchen auf jeder Rechnung auf.",
      no: "Kein Ersatz für ein Angebot des Elektrikers.",
    },
    en: {
      yes: "Always budget for it: outlets, entries and surge protection show up on every invoice.",
      no: "No substitute for an electrician's quote.",
    },
  },
  "gear:irflood": {
    de: {
      yes: "Wenn eine G6 180 nachts weiter sehen soll als ihre 20 m.",
      no: "Nicht bei Kameras, die ohnehin 30 m oder mehr ausleuchten.",
    },
    en: {
      yes: "When a G6 180 has to see further at night than its own 20 m.",
      no: "Not for cameras that already light up 30 m or more.",
    },
  },
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

export const whenOf = (kind: string, key: string): WhenEntry | null =>
  WHEN[kind + ":" + key] || null;

// ---------- Metric and groups: one place for select fields and hover card ----------
// What the part provides, in one line: "8× PoE · 52 W", "2× SFP", "IP54 · 6 ports".
// Units (PoE, SFP, W, m) are the same in both languages — only text gets translated.
export function optHint(kind: string, key: string): string {
  const m = catEntry(kind, key);
  if (!m) return "";
  const p: string[] = [];
  if (kind === "cam") p.push(m.res, m.fov >= 360 ? "PTZ" : m.fov + "°", "IR " + m.ir + " m");
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
