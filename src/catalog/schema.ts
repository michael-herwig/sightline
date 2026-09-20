// The shape of every `src/catalog/<kind>-<id>/product.json`.
//
// One folder per product, one file per product: the folder is also where a local
// `image.webp` goes (see tools/fetch-images.mjs), and a diff touches exactly the
// product that changed instead of a 2000-line module.
//
// `schema.json` next to this file is generated from these types
// (`ocx exec -- task catalog:schema`) so an editor validates the JSON while it is
// being typed. Change a type here, regenerate, commit both.
//
// Two layers on purpose:
//   * the top level is what every product has — who makes it, what it costs,
//     what it is for, where to buy it, and the vendor facts (`ports`, `beam`,
//     `open`, `codecs`) as the data sheet states them.
//   * `specs` holds what no connector can say: the PoE budget in watts, whether
//     the thing is an active device, how far a PoE extender reaches, and on a
//     housing how many conduits it takes.
//
// **The port list is the truth.** Port counts, SFP cages and what an injector
// passes on are derived from `ports` in `src/catalog/index.ts` — never curated
// a second time under `specs`, or the two drift apart. A FRITZ!Box SFP cage is
// the WAN port, so it is typed `wan` and no fibre lands there; the same goes for
// the UCG's WAN uplinks.

/** A bilingual text. Both languages are mandatory — `tx()` picks one. */
export interface Txt {
  de: string;
  en: string;
}

/** Bilingual word lists: the search tags on a card. */
export interface Tags {
  de: string[];
  en: string[];
}

/**
 * One connector as the data sheet lists it — and the only place that says what a
 * device can be wired to.
 *
 * `dir` is about the cable, not the data: `in` takes an uplink or a feed (a
 * camera's socket, a switch's PoE-in port, an injector's data jack), `out` only
 * ever goes downstream (an injector's PoE jack), `both` is an ordinary switch
 * port that an uplink or a camera can land on alike. `wan` is where the internet
 * arrives and never counts as a LAN port.
 */
export interface Port {
  type: "rj45" | "sfp" | "sfp+" | "dc" | "wan";
  dir: "in" | "out" | "both";
  /** How many of this kind. An SFP module has an interface but brings no cage: `0`. */
  n: number;
  /** "1G", "2.5G", "10G", "100M", "1G/2.5G" — as printed, not normalised. */
  speed?: string;
  /** PoE class this port hands out. `"af/at"` is a port that negotiates either. */
  poe?: "af" | "at" | "bt" | "af/at";
}

/** Radiation pattern of an access point. `h: 360` is omnidirectional. */
export interface Beam {
  /** Horizontal opening in degrees, on the band the reliable zone is drawn from (5 GHz). */
  h: number;
  /**
   * Horizontal opening of the wider, lower band (2.4 GHz), which is what the outer
   * free-field ring shows. Absent means the same as `h`.
   */
  hFar?: number;
  /** Vertical opening in degrees, where the vendor publishes one. */
  v?: number;
  /** Rear lobe as a fraction of the main lobe, 0…1. An omni is 1. */
  back?: number;
}

/**
 * How far a camera can be driven without the vendor's own console or app.
 * A field that no data sheet confirmed is left out rather than guessed —
 * "unknown" and "no" are different answers.
 */
export interface Openness {
  /** `"via-console"`: only the vendor's recorder re-streams it. */
  rtsp?: boolean | "via-console";
  onvif?: boolean;
  api?: "none" | "community" | "documented";
  /** `"required"`: nothing works without the vendor cloud. */
  cloud?: "optional" | "required";
}

/** Video codecs per stream, lower-case tokens ("h264", "h265"). */
export interface Codecs {
  main: string[];
  sub?: string[];
}

/** Where to buy it. `vendor` is a path under the UniFi store or an absolute URL. */
export interface Links {
  vendor?: string;
  /** A verified `https://www.amazon.de/dp/<ASIN>` — never guessed. */
  amazon?: string;
  /** The Amazon link is an equivalent substitute, not the original item. */
  amazonSimilar?: boolean;
}

/**
 * The numbers the planner computes with. Every field is optional here because
 * one file serves four kinds; which ones a kind must carry is checked in
 * tests/unit/catalog.test.ts.
 */
export interface Specs {
  // --- camera
  /** "4K · 8 MP · 1/1.8\"" — "4K" in it counts as 4K for the NVR warning. */
  res?: string;
  /** Night-vision range in m; drives the cone radius. */
  ir?: number;
  /** Opening in degrees; 360 means pan/tilt and is drawn as a circle. */
  fov?: number;
  /** Optical or hybrid zoom, as printed. */
  zoom?: string;
  // --- camera and access point
  /** How it is powered, as printed ("PoE+ (802.3at)"). */
  poe?: string | Txt | number;
  /** IP/IK rating, as printed. */
  ip?: string;
  /** Set explicitly, never guessed from `ip` — drives the mount row and the filters. */
  out?: boolean;
  /** Camera: runs on Wi-Fi. Access point: the radio, as printed. */
  wifi?: boolean | string;
  // --- access point
  /** Rough free-field range in m. */
  radius?: number;
  place?: "in" | "out";
  // --- junction
  /**
   * Conduit openings on a housing (and fibre entries on a splice closure).
   * A device's network ports are **not** here: they come out of `ports`.
   */
  ports?: number;
  /** Active device: it needs a place of its own, not necessarily mains power. */
  power?: boolean;
  /** Goes into the ground; drives the select groups. */
  dig?: boolean;
  /** One line on the card: what the part is for. */
  use?: Txt;
  /** A PoE extender raises the copper limit of its run, in m. */
  extend?: number;
  /** Load on the feeder for a `powerIn: "poe"` device; 15 W when absent. */
  poeDraw?: number;
  // --- head end and accessories
  /** Exactly one entry per plan carries `"router"`. */
  role?: string;
  /** Default quantity when the item is switched on. */
  qty?: number;
  /** Preselected in a fresh plan — always false, the plan starts empty. */
  on?: boolean;
  /** Kept out of the gear tab (switches sit on the map as elements). */
  hidden?: boolean;
  /** The subtitle under the name in the gear tab. */
  sub?: Txt;
}

/** One catalogue entry. */
export interface Product {
  id: string;
  /** Which catalogue it lands in. */
  kind: "cam" | "ap" | "jb" | "infra";
  /** Junctions only: a place (`housing`) or something that goes into one (`device`). */
  form?: "housing" | "device";
  /** `"any"` = vendor-neutral (shaft, box, cabinet); it passes every vendor filter. */
  vendor: string;
  /** Anything but `current` is hidden from the pickers unless "show deprecated" is on. */
  status: "current" | "deprecated" | "eol";
  /** The id that replaces this one. Only with a status other than `current`. */
  successor?: string;
  /** Sort key inside the kind, in steps of ten so something fits in between. */
  order: number;
  name: Txt;
  /** EUR including VAT. */
  price: number;
  /** When the price was last checked, `YYYY-MM`. */
  priceDate: string;
  /** Two sentences for the card and the data sheet. */
  description?: Txt;
  /** "Good for" on the data sheet. */
  useCases?: Txt;
  /** "Less suited" on the data sheet. */
  caveats?: Txt;
  links?: Links;
  /** Image URL at the vendor. A local `image.webp` in the same folder wins. */
  img?: string;
  tags?: Tags;
  /** Where it goes (junctions). */
  mount?: Txt;
  /** Where a device draws power from. Housings carry none. */
  powerIn?: "mains" | "poe" | "none";
  /** The connectors as the data sheet lists them. */
  ports?: Port[];
  /** The PoE class the device itself accepts. */
  poeIn?: "af" | "at" | "bt" | "af/at";
  beam?: Beam;
  open?: Openness;
  codecs?: Codecs;
  specs: Specs;
}
