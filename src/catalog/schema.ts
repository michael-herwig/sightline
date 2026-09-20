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
//   * `specs` holds the numbers the planner computes with. They are curated, not
//     copied: `sfp` on a router means "usable on the LAN side" (a FRITZ!Box SFP
//     cage is the WAN port, so `false` despite the port list), `poePorts` counts
//     what an injector passes on, and on a housing `ports` counts conduits, not
//     RJ45. That is why nothing here is derived from `ports` — see
//     tests/unit/catalog.test.ts, which pins the two against each other.

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

/** One connector as the data sheet lists it. `dir: "in"` is an uplink or a feed. */
export interface Port {
  type: "rj45" | "sfp" | "sfp+" | "dc" | "wan";
  dir: "in" | "out" | "both";
  /** How many of this kind. */
  n: number;
  /** "1G", "2.5G", "10G", "100M", "1G/2.5G" — as printed, not normalised. */
  speed?: string;
  /** PoE class this port hands out. `"af/at"` is a port that negotiates either. */
  poe?: "af" | "at" | "bt" | "af/at";
}

/** Radiation pattern of an access point. `h: 360` is omnidirectional. */
export interface Beam {
  /** Horizontal opening in degrees. */
  h: number;
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
  /** Network ports on a device — conduit openings on a housing. */
  ports?: number;
  /** Active device: it needs a place of its own, not necessarily mains power. */
  power?: boolean;
  /** Goes into the ground; drives the select groups. */
  dig?: boolean;
  /** One line on the card: what the part is for. */
  use?: Txt;
  /** Fibre plugs straight in — on a router this means LAN-side. */
  sfp?: boolean;
  /** SFP cages, read off the data sheet rather than counted from `ports`. */
  sfpPorts?: number;
  /** What an injector passes on: it has two jacks and one downstream port. */
  poePorts?: number;
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
