// The shapes the planner works with, derived from docs/DATA-MODEL.md.
// Catalogue entries are deliberately wide: a camera has no `poe` budget and a
// housing has no `powerIn`, so the optional fields say "may be there", and the
// invariants that actually hold are checked in tests/unit/catalogs.test.ts.

/** A UI text. Catalogue texts are bilingual and go through tx(). */
export type Txt = string | { de: string; en: string };

/** Bilingual word lists, e.g. the search tags on a camera. */
export type Tags = { de: string[]; en: string[] };

export type CableType = "fiber" | "cat" | "power";
export type PipeType = "dn50" | "dn63";
export type ItemKind = "cam" | "ap" | "jb" | "hub";
export type SelKind = ItemKind | "item" | "conduit" | "infra";
export type Lang = "de" | "en";

// ---------------------------------------------------------------- catalogues

/** Shared by every catalogue entry: what the shop links and the card need. */
export interface Product {
  name: Txt;
  price?: number;
  img?: string;
  url?: string;
  amazon?: string;
  amazonSimilar?: boolean;
  vendor?: string;
  note?: Txt;
  tags?: Tags;
}

/** CAMS[model] — a camera. `fov` 360 means PTZ and is drawn as a circle. */
export interface Cam extends Product {
  price: number;
  res: string;
  ir: number;
  fov: number;
  poe: Txt;
  ip: string;
  out: boolean;
  wifi?: boolean;
  zoom?: string;
}

/** APS[model] — an access point. `radius` is a rough free-field range in m. */
export interface Ap extends Product {
  price: number;
  radius: number;
  out: boolean;
  wifi?: string;
  ip?: string;
  poe?: Txt;
  place?: string;
}

/**
 * JUNCTIONS[model] — one map for two roles, told apart by `kind`, never by
 * `power`: a splice box, surge protector, SFP module and PoE extender need no
 * power and are still devices.
 */
export interface Junction extends Product {
  kind: "housing" | "device";
  price: number;
  /** Active device — needs a place, not necessarily mains power. */
  power?: boolean;
  /** Where it draws power from. Housings carry none. */
  powerIn?: "mains" | "poe" | "none";
  /** PoE budget in W the device hands out; 0 = supplies nothing. */
  poe?: number;
  /** Load on the feeder for a `powerIn: "poe"` device, 15 W when absent. */
  poeDraw?: number;
  /** Fibre plugs straight in. */
  sfp?: boolean;
  /** SFP cages, read off the data sheet rather than from the port count. */
  sfpPorts?: number;
  /** RJ45 ports. */
  ports?: number;
  /** An injector has two jacks but only one downstream port. */
  poePorts?: number;
  /** A PoE extender raises the copper limit of its run, in m. */
  extend?: number;
  ip?: string;
  mount?: Txt;
  use?: Txt;
  /** Housing that goes into the ground — drives the select groups. */
  dig?: boolean;
}

/** INFRA[] — head end and accessories: elements without a position. */
export interface InfraItem extends Product {
  id: string;
  price: number;
  qty: number;
  on: boolean;
  sub?: Txt;
  /** Exactly one router per plan carries the LAN ports, SFP and PoE. */
  role?: string;
  ports?: number;
  /** Usable on the LAN side — on a FRITZ!Box the SFP cage is the WAN port. */
  sfp?: boolean;
  poe?: number;
  /** Switches sit on the map as elements, so they stay out of the gear tab. */
  hidden?: boolean;
}

/** PIPES[pipe] — `m` is € per metre. */
export interface PipeSpec {
  name: Txt;
  m: number;
}

/** CABLES[type] — `m` € per metre, `fixed` € per cable, `max` the copper limit. */
export interface CableSpec {
  name: Txt;
  m: number;
  fixed: number;
  color: string;
  note?: Txt;
  /** The long form in the ⓘ dialogue. */
  info?: Txt;
  max?: number;
}

/**
 * A catalogue entry reached through the generic path (CATALOG, modelOf,
 * catEntry). Which of the three shapes it is depends on the element's kind, and
 * every caller already knows — so this one stays loose while CAMS, APS and
 * JUNCTIONS keep their precise types for direct access.
 */
export type Model = any;

/** CONDUITS[key] — a catalogue template: a conduit without id, points or label. */
export interface CondTemplate {
  name: Txt;
  kind: "trench" | "cable";
  ducts: Duct[];
}

/** A retailer in the product box. */
export interface Shop {
  label: string;
  url: (q: string) => string;
}

/** WAN[type] — the connection at the head end. */
export interface WanSpec {
  name: Txt;
  speeds: number[];
}

/** WHEN["<kind>:<key>"] — when the model fits and when it does not. */
export interface WhenEntry {
  de: { yes: string; no: string };
  en: { yes: string; no: string };
}

// --------------------------------------------------------------------- plan

/** One cable type inside a duct, with its quantity. */
export interface Cable {
  type: CableType;
  n: number;
}

/** A duct. A cable run has exactly one bundle and no `pipe`. */
export interface Duct {
  pipe?: PipeType;
  cables: Cable[];
}

/** Anything that sits on the plan: an element or a conduit point. */
export interface Placed {
  x: number;
  y: number;
  e?: number;
  n?: number;
}

/** What stampGeo()/unstampGeo() need — a plan, or a fixture shaped like one. */
export interface Stampable {
  items?: Placed[];
  conduits?: { points?: Placed[] }[];
}

/** A point of a conduit. `at` binds it to an element, syncBonds() keeps x/y. */
export interface Point extends Placed {
  at?: string;
}

/**
 * A trench (1–6 ducts, each with its own type and price, plus earthwork) or a
 * cable run (exactly one bundle, no duct, no earthwork).
 */
export interface Conduit {
  id: string;
  kind?: "trench" | "cable";
  ducts: Duct[];
  points: Point[];
  label?: string;
  /** Only on states old enough to predate per-duct types; migrateConduit() drops it. */
  pipe?: string;
  /** Only in the oldest shape: `{ type, cables: <number> }`. */
  type?: string;
  cables?: Cable[] | number;
}

/** A device inside a junction or at the head end. */
export interface Gear {
  model: string;
  n: number;
}

/** The connection at the head end. */
export interface Wan {
  type: "dsl" | "fiber";
  speed: number;
}

/**
 * An element on the map. The fields that only one kind carries stay optional —
 * `kind` tells them apart, and every reader already branches on it.
 */
export interface Item extends Placed {
  id: string;
  kind: ItemKind;
  label: string;
  note?: string;
  /** Camera and AP: the catalogue key. Junction: the housing. */
  model?: string;
  /** Camera: degrees, 0 = east, 90 = south. */
  rot?: number;
  /** Devices inside a junction or at the head end. */
  gear?: Gear[];
  /** Head end only. */
  wan?: Wan;
  /** AP only. */
  rings?: "both" | "far" | "near" | "none";
  place?: "in" | "out";
  /** Head end only: the address the plan was seeded from. */
  addr?: string;
  parcel?: string;
}

/** Appearance factors behind the gear icon. Not part of the undo history. */
export interface Look {
  size: number;
  font: number;
  alpha: number;
  line: number;
  cluster: boolean;
}

/** The five map toggles behind the eye. A missing key counts as on. */
export interface Show {
  cones?: boolean;
  rings?: boolean;
  conds?: boolean;
  labels?: boolean;
  sections?: boolean;
}

/** The viewport in plan pixels. */
export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The plan origin in EPSG:25832. */
export interface Geo {
  e0: number;
  n0: number;
}

/** What makes up the working state — this is what survives a reload and travels in the share link. */
export interface State {
  items: Item[];
  conduits: Conduit[];
  infra: Record<string, { on: boolean; qty: number }>;
  budget: number;
  earthwork: number;
  seq: number;
  lang: Lang;
  basemap: string;
  overlay: boolean;
  view: View | null;
  name: string;
  sub: string;
  shop: string;
  dock: unknown;
  dockSize: Record<string, { width?: number; height?: number }>;
  geo: Geo;
  show: Show;
  look: Look;
  catTab: string;
  catQuery: Record<string, string>;
  catFacets: string[];
  toolLabels: boolean;
}

/** What the selection points at. `infra` has no position. */
export interface Sel {
  kind: SelKind;
  id: string;
}

// -------------------------------------------------------------- connections

/** One finding. `key` is a `link.*` key — every display goes through linkText(). */
export interface LinkStatus {
  g: "ok" | "warn" | "err";
  key: string;
  vars?: Record<string, string | number>;
  /** Further findings when several apply at once. */
  more?: { key: string; vars?: Record<string, string | number> }[];
}

/** Where a device is fed from, and how far away that is. */
export interface LinkSource {
  src: Item;
  len: number;
  first?: CableType;
  maxCat?: number;
}

/** Load and ports at an active junction or at the head end. */
export interface LinkGear {
  devices: Item[];
  watts: number;
  used: number;
  poe: number;
  ports: number;
  over: boolean;
  portsOver: boolean;
}

/** The result of links(). None of it lives in the state. */
export interface Links {
  status: Map<string, LinkStatus>;
  src: Map<string, LinkSource>;
  gear: Map<string, LinkGear>;
  touch: Map<string, Conduit[]>;
}
