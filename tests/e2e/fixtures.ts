// Test plans for the Playwright suite. Carried over from the jsdom boots in
// tools/check.mjs — made-up locations, origin Cologne Cathedral (GEO_DEFAULT), so that
// nothing property-related ends up in the repo.
//
// Deliberately loosely typed: the planner has no types until the TS rewrite, and the
// fixtures also need to be able to carry old conduit and junction shapes.

/** PX_PER_M from public/planner/index.html — 1 m on the map. */
export const PX = 5.957;

/** GEO_DEFAULT from public/planner/index.html: Cologne Cathedral, EPSG:25832. */
export const GEO = { e0: 356448.6, n0: 5645366.7 };

export type Plan = Record<string, unknown>;

/**
 * Drawing, groups, conduit shapes, migration of old states.
 * Source: tools/check.mjs, first jsdom boot.
 */
export const drawPlan: Plan = {
  name: "Prüfplan",
  sub: "",
  lang: "de",
  budget: 3000,
  earthwork: 12,
  seq: 9,
  geo: { ...GEO },
  items: [
    {
      id: "hub",
      kind: "hub",
      label: "H",
      x: 100,
      y: 100,
      note: "Wohnhaus",
      wan: { type: "fiber", speed: 1000 },
    },
    {
      id: "k1",
      kind: "cam",
      model: "g6-bullet",
      label: "K1",
      x: 170,
      y: 70,
      rot: 300,
      note: "Zufahrt",
    },
    { id: "k2", kind: "cam", model: "g6-180", label: "K2", x: 90, y: 160, rot: 200, note: "Hof" },
    { id: "a1", kind: "ap", model: "u7-pro", label: "A1", x: 140, y: 160, note: "innen" },
    { id: "j1", kind: "jb", model: "shaft", label: "J1", x: 200, y: 200, note: "Abzweig" },
    { id: "s1", kind: "jb", model: "flex", label: "S1", x: 300, y: 260, note: "Nebengebäude" },
    { id: "s2", kind: "jb", model: "conv", label: "S2", x: 260, y: 320, note: "Mast" },
    // Two elements 1 m apart (5.957 px): the map has to turn these into a group.
    { id: "z1", kind: "cam", model: "g6-bullet", label: "Z1", x: 360, y: 60, rot: 0, note: "" },
    { id: "z2", kind: "ap", model: "u7-pro", label: "Z2", x: 365.96, y: 60, note: "" },
  ],
  conduits: [
    {
      id: "c1",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 2 }],
      label: "Stamm",
      points: [
        { x: 100, y: 100 },
        { x: 160, y: 160 },
        { x: 200, y: 200, at: "j1" },
        { x: 300, y: 260, at: "s1" },
      ],
    },
    {
      id: "c2",
      pipe: "dn50",
      ducts: 1,
      cables: [],
      label: "Zweig",
      points: [
        { x: 200, y: 200, at: "j1" },
        { x: 260, y: 320, at: "s2" },
      ],
    },
    {
      id: "c3",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Kupfer",
      points: [
        { x: 300, y: 260, at: "s1" },
        { x: 360, y: 300 },
      ],
    },
    // Ends at Z1 — i.e., at an element that's inside the group.
    {
      id: "cz",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Gruppe",
      points: [
        { x: 300, y: 260, at: "s1" },
        { x: 360, y: 60, at: "z1" },
      ],
    },
    // New shape: each duct carries its own cables. Third duct empty.
    {
      id: "c4",
      pipe: "dn63",
      label: "Bündel",
      ducts: [
        { cables: [{ type: "fiber", n: 2 }] },
        { cables: [{ type: "cat", n: 1 }] },
        { cables: [] },
      ],
      points: [
        { x: 110, y: 300 },
        { x: 250, y: 300 },
      ],
    },
    // Cable without a duct: no trench, no duct line, just the run.
    {
      id: "c5",
      pipe: "none",
      ducts: [{ cables: [{ type: "cat", n: 1 }] }],
      label: "Direkt",
      points: [
        { x: 110, y: 330 },
        { x: 250, y: 330 },
      ],
    },
    // The oldest shape: a template key plus a cable count.
    {
      id: "cold",
      type: "fiber",
      cables: 1,
      label: "Alt",
      points: [
        { x: 110, y: 270 },
        { x: 250, y: 270 },
      ],
    },
    // Two duct types in one trench; 59.57 px is exactly 10 m.
    {
      id: "cmix",
      kind: "trench",
      label: "",
      ducts: [
        { pipe: "dn50", cables: [] },
        { pipe: "dn63", cables: [] },
      ],
      points: [
        { x: 400, y: 400 },
        { x: 459.57, y: 400 },
      ],
    },
    // Old duct type "none" — this turns into its own kind of cable run.
    {
      id: "cbare",
      pipe: "none",
      ducts: [{ cables: [{ type: "cat", n: 2 }] }],
      label: "Kabelzug",
      points: [
        { x: 400, y: 420 },
        { x: 459.57, y: 420 },
      ],
    },
    // Flat shape with three ducts: each duct inherits the old duct type.
    {
      id: "c63",
      pipe: "dn63",
      ducts: 3,
      cables: [{ type: "cat", n: 1 }],
      label: "Dreirohr",
      points: [
        { x: 400, y: 440 },
        { x: 459.57, y: 440 },
      ],
    },
    // Very old shape with two cables from the template.
    {
      id: "cold2",
      type: "fiber",
      cables: 2,
      label: "Alt zwei",
      points: [
        { x: 400, y: 460 },
        { x: 459.57, y: 460 },
      ],
    },
  ],
  // Without a saved viewport the planner starts at the 2.5 km overview — there the
  // entire test plan would sit in a single group. The test wants the working zoom.
  view: { x: -60, y: -60, w: 620, h: 620 },
  infra: {},
};

/**
 * Topology: fiber from the house to the switch, copper to the camera — plus every
 * finding that links() knows. Source: tools/check.mjs, second jsdom boot; `kl` is new
 * and covers the 90 m finding that check.mjs didn't have.
 */
export const linkPlan: Plan = {
  name: "Anschlussplan",
  sub: "",
  lang: "de",
  budget: 3000,
  earthwork: 0,
  seq: 9,
  geo: { ...GEO },
  items: [
    {
      id: "h1",
      kind: "hub",
      label: "H1",
      x: 100,
      y: 100,
      note: "",
      wan: { type: "fiber", speed: 1000 },
    },
    {
      id: "s1",
      kind: "jb",
      model: "indoor",
      gear: [{ model: "flex", n: 1 }],
      label: "S1",
      x: 300,
      y: 260,
      note: "",
    },
    {
      id: "k1",
      kind: "cam",
      model: "g6-bullet",
      label: "K1",
      x: 300 + 40 * PX,
      y: 260,
      rot: 0,
      note: "",
    },
    { id: "k2", kind: "cam", model: "g6-bullet", label: "K2", x: 800, y: 700, rot: 0, note: "" },
    // Over 90 m of Cat6A on the same switch: the finding stays "supplied" but warns.
    {
      id: "kl",
      kind: "cam",
      model: "g6-bullet",
      label: "KL",
      x: 300,
      y: 260 + 110 * PX,
      rot: 0,
      note: "",
    },
    // Switch without SFP at the fiber end, and a camera that needs no cable at all
    { id: "s3", kind: "jb", model: "lite8", label: "S3", x: 200, y: 600, note: "" },
    { id: "k3", kind: "cam", model: "g6-instant", label: "K3", x: 500, y: 800, rot: 0, note: "" },
    // Two switches that only hang off each other — unreachable from the hub
    { id: "s4", kind: "jb", model: "usw-ultra-60w", label: "S4", x: 1000, y: 200, note: "" },
    { id: "s5", kind: "jb", model: "usw-ultra-60w", label: "S5", x: 1100, y: 300, note: "" },
    // Switch connected to S1 via copper — it occupies a port there and draws no power
    {
      id: "s7",
      kind: "jb",
      model: "usw-ultra-60w",
      label: "S7",
      x: 300 + 20 * PX,
      y: 400,
      note: "",
    },
    // Media converter: one port, uplink over fiber, one camera attached
    { id: "c1", kind: "jb", model: "conv", label: "C1", x: 1200, y: 800, note: "" },
    {
      id: "k9",
      kind: "cam",
      model: "g6-bullet",
      label: "K9",
      x: 1200 + 25 * PX,
      y: 800,
      rot: 0,
      note: "",
    },
    // Fiber into a passive shaft, copper behind it: that's not an uplink
    { id: "j9", kind: "jb", model: "shaft", label: "J9", x: 700, y: 900, note: "" },
    { id: "s8", kind: "jb", model: "flex", label: "S8", x: 900, y: 900, note: "" },
    // Distribution box with two devices: converter makes copper, switch distributes further.
    {
      id: "j5",
      kind: "jb",
      model: "cab",
      gear: [
        { model: "tplink-mc220l", n: 1 },
        { model: "usw-ultra-60w", n: 1 },
      ],
      label: "J5",
      x: 1400,
      y: 200,
      note: "",
    },
    {
      id: "k5",
      kind: "cam",
      model: "g6-bullet",
      label: "K5",
      x: 1400 + 25 * PX,
      y: 200,
      rot: 0,
      note: "",
    },
    // The same box, but empty: the fiber runs through, the copper behind it has no source.
    { id: "j6", kind: "jb", model: "cab", gear: [], label: "J6", x: 1400, y: 600, note: "" },
    {
      id: "k6",
      kind: "cam",
      model: "g6-bullet",
      label: "K6",
      x: 1400 + 25 * PX,
      y: 600,
      rot: 0,
      note: "",
    },
    // Camera directly on the hub: checks the router's PoE output and ports
    {
      id: "kh",
      kind: "cam",
      model: "g6-bullet",
      label: "KH",
      x: 100 + 20 * PX,
      y: 100,
      rot: 0,
      note: "",
    },
    // Camera on the island: connected, but its own source hangs off nothing
    {
      id: "k4",
      kind: "cam",
      model: "g6-bullet",
      label: "K4",
      x: 1000 + 20 * PX,
      y: 200,
      rot: 0,
      note: "",
    },
    // Shaft with a splice box: here a fiber is actually allowed to be split
    {
      id: "j7",
      kind: "jb",
      model: "shaft",
      gear: [{ model: "splice", n: 1 }],
      label: "J7",
      x: 700,
      y: 300,
      note: "",
    },
    // Fiber directly to a camera: its own finding, not the converter's before it
    { id: "kf", kind: "cam", model: "g6-bullet", label: "KF", x: 1200, y: 1000, rot: 0, note: "" },
    // Two SFP slots, two incoming fibers: that works out.
    {
      id: "s9",
      kind: "jb",
      model: "indoor",
      gear: [{ model: "omada-sg2210mp", n: 1 }],
      label: "S9",
      x: 1600,
      y: 1000,
      note: "",
    },
    { id: "j8", kind: "jb", model: "shaft", label: "J8", x: 1500, y: 1200, note: "" },
  ],
  conduits: [
    {
      id: "cf",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser",
      points: [
        { x: 100, y: 100, at: "h1" },
        { x: 300, y: 260, at: "s1" },
      ],
    },
    {
      id: "cc",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Kupfer",
      points: [
        { x: 300, y: 260, at: "s1" },
        { x: 300 + 40 * PX, y: 260, at: "k1" },
      ],
    },
    {
      id: "cl",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Langes Kupfer",
      points: [
        { x: 300, y: 260, at: "s1" },
        { x: 300, y: 260 + 110 * PX, at: "kl" },
      ],
    },
    {
      id: "cf2",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser 2",
      points: [
        { x: 100, y: 100, at: "h1" },
        { x: 200, y: 600, at: "s3" },
      ],
    },
    {
      id: "cs",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Insel",
      points: [
        { x: 1000, y: 200, at: "s4" },
        { x: 1100, y: 300, at: "s5" },
      ],
    },
    {
      id: "cd",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Kaskade",
      points: [
        { x: 300, y: 260, at: "s1" },
        { x: 300 + 20 * PX, y: 400, at: "s7" },
      ],
    },
    {
      id: "cv",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Konverter",
      points: [
        { x: 100, y: 100, at: "h1" },
        { x: 1200, y: 800, at: "c1" },
      ],
    },
    {
      id: "cvk",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Konverter-Kabel",
      points: [
        { x: 1200, y: 800, at: "c1" },
        { x: 1200 + 25 * PX, y: 800, at: "k9" },
      ],
    },
    {
      id: "cj",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser in den Schacht",
      points: [
        { x: 900, y: 900, at: "s8" },
        { x: 700, y: 900, at: "j9" },
      ],
    },
    {
      id: "cjk",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Kupfer aus dem Schacht",
      points: [
        { x: 700, y: 900, at: "j9" },
        { x: 100, y: 100, at: "h1" },
      ],
    },
    {
      id: "cfree",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Frei",
      points: [
        { x: 1000, y: 200, at: "s4" },
        { x: 1200, y: 400 },
      ],
    },
    {
      id: "cj5",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser Kasten",
      points: [
        { x: 100, y: 100, at: "h1" },
        { x: 1400, y: 200, at: "j5" },
      ],
    },
    {
      id: "cj5k",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Kasten-Kabel",
      points: [
        { x: 1400, y: 200, at: "j5" },
        { x: 1400 + 25 * PX, y: 200, at: "k5" },
      ],
    },
    {
      id: "cj6",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser leerer Kasten",
      points: [
        { x: 100, y: 100, at: "h1" },
        { x: 1400, y: 600, at: "j6" },
      ],
    },
    {
      id: "cj6k",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Kabel aus dem leeren Kasten",
      points: [
        { x: 1400, y: 600, at: "j6" },
        { x: 1400 + 25 * PX, y: 600, at: "k6" },
      ],
    },
    {
      id: "chk",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Zentralkabel",
      points: [
        { x: 100, y: 100, at: "h1" },
        { x: 100 + 20 * PX, y: 100, at: "kh" },
      ],
    },
    {
      id: "cik",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Inselkabel",
      points: [
        { x: 1000, y: 200, at: "s4" },
        { x: 1000 + 20 * PX, y: 200, at: "k4" },
      ],
    },
    {
      id: "cj7",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser zum Spleiss",
      points: [
        { x: 300, y: 260, at: "s1" },
        { x: 700, y: 300, at: "j7" },
      ],
    },
    {
      id: "cvf",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser an die Kamera",
      points: [
        { x: 1200, y: 800, at: "c1" },
        { x: 1200, y: 1000, at: "kf" },
      ],
    },
    {
      id: "cs9a",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser 1 nach S9",
      points: [
        { x: 100, y: 100, at: "h1" },
        { x: 1600, y: 1000, at: "s9" },
      ],
    },
    {
      id: "cs9b",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser 2 nach S9",
      points: [
        { x: 1600, y: 1000, at: "s9" },
        { x: 1500, y: 1200, at: "j8" },
      ],
    },
  ],
  // Working zoom, so the markers stand individually and don't collapse into groups.
  view: { x: 0, y: 0, w: 1700, h: 1700 },
  // The hub needs a router: without it, it accepts neither fiber nor copper.
  infra: { ucg: { on: true, qty: 1 } },
};

/**
 * Passing fiber on at the switch, power at the point (230 V / PoE-fed).
 * Source: tools/check.mjs, third jsdom boot.
 */
export const powerPlan: Plan = {
  name: "Strom und Faser",
  sub: "",
  lang: "de",
  budget: 3000,
  earthwork: 0,
  seq: 9,
  geo: { ...GEO },
  items: [
    {
      id: "h1",
      kind: "hub",
      label: "H1",
      x: 100,
      y: 100,
      note: "",
      wan: { type: "fiber", speed: 1000 },
    },
    // Four SFP slots: one fiber comes in, two continue on — nothing gets spliced.
    {
      id: "f1",
      kind: "jb",
      model: "indoor",
      gear: [{ model: "mikrotik-crs305", n: 1 }],
      label: "F1",
      x: 300,
      y: 100,
      note: "",
    },
    {
      id: "f2",
      kind: "jb",
      model: "indoor",
      gear: [{ model: "flex", n: 1 }],
      label: "F2",
      x: 500,
      y: 100,
      note: "",
    },
    {
      id: "f3",
      kind: "jb",
      model: "indoor",
      gear: [{ model: "flex", n: 1 }],
      label: "F3",
      x: 500,
      y: 200,
      note: "",
    },
    // The same fan-out on only two slots: the branches stand, the count doesn't.
    {
      id: "g1",
      kind: "jb",
      model: "indoor",
      gear: [{ model: "omada-sg2210mp", n: 1 }],
      label: "G1",
      x: 300,
      y: 400,
      note: "",
    },
    {
      id: "g2",
      kind: "jb",
      model: "indoor",
      gear: [{ model: "flex", n: 1 }],
      label: "G2",
      x: 500,
      y: 400,
      note: "",
    },
    {
      id: "g3",
      kind: "jb",
      model: "indoor",
      gear: [{ model: "conv", n: 1 }],
      label: "G3",
      x: 500,
      y: 500,
      note: "",
    },
    // Power at the point: shaft without a power cable, shaft with one, and the same device indoors.
    {
      id: "m1",
      kind: "jb",
      model: "shaft",
      gear: [{ model: "conv", n: 1 }],
      label: "M1",
      x: 700,
      y: 100,
      note: "",
    },
    {
      id: "m2",
      kind: "jb",
      model: "shaft",
      gear: [{ model: "conv", n: 1 }],
      label: "M2",
      x: 700,
      y: 200,
      note: "",
    },
    {
      id: "m3",
      kind: "jb",
      model: "indoor",
      gear: [{ model: "conv", n: 1 }],
      label: "M3",
      x: 700,
      y: 300,
      note: "",
    },
    // PoE-fed: no power supply needed, but it takes 15 W from the feeder's budget.
    {
      id: "p1",
      kind: "jb",
      model: "shaft",
      gear: [{ model: "usw-flex-mini", n: 1 }],
      label: "P1",
      x: 900,
      y: 100,
      note: "",
    },
    // Switch with a power supply in the shaft: here there's a PoE-fed counterpart.
    {
      id: "a1",
      kind: "jb",
      model: "shaft",
      gear: [{ model: "lite8", n: 1 }],
      label: "A1",
      x: 900,
      y: 200,
      note: "",
    },
  ],
  conduits: [
    {
      id: "cf1",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser F1",
      points: [
        { x: 100, y: 100, at: "h1" },
        { x: 300, y: 100, at: "f1" },
      ],
    },
    {
      id: "cf2",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser F2",
      points: [
        { x: 300, y: 100, at: "f1" },
        { x: 500, y: 100, at: "f2" },
      ],
    },
    {
      id: "cf3",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser F3",
      points: [
        { x: 300, y: 100, at: "f1" },
        { x: 500, y: 200, at: "f3" },
      ],
    },
    {
      id: "cg1",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser G1",
      points: [
        { x: 100, y: 100, at: "h1" },
        { x: 300, y: 400, at: "g1" },
      ],
    },
    {
      id: "cg2",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser G2",
      points: [
        { x: 300, y: 400, at: "g1" },
        { x: 500, y: 400, at: "g2" },
      ],
    },
    {
      id: "cg3",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser G3",
      points: [
        { x: 300, y: 400, at: "g1" },
        { x: 500, y: 500, at: "g3" },
      ],
    },
    {
      id: "cm1",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Kupfer M1",
      points: [
        { x: 500, y: 100, at: "f2" },
        { x: 700, y: 100, at: "m1" },
      ],
    },
    {
      id: "cm2",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Kupfer M2",
      points: [
        { x: 500, y: 100, at: "f2" },
        { x: 700, y: 200, at: "m2" },
      ],
    },
    // The power cable covers the need at the point — that's all it does here.
    {
      id: "cpw",
      pipe: "dn63",
      ducts: 1,
      cables: [{ type: "power", n: 1 }],
      label: "Strom M2",
      points: [
        { x: 700, y: 400 },
        { x: 700, y: 200, at: "m2" },
      ],
    },
    {
      id: "cm3",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Kupfer M3",
      points: [
        { x: 500, y: 100, at: "f2" },
        { x: 700, y: 300, at: "m3" },
      ],
    },
    {
      id: "cp1",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Kupfer P1",
      points: [
        { x: 500, y: 100, at: "f2" },
        { x: 900, y: 100, at: "p1" },
      ],
    },
    {
      id: "ca1",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Kupfer A1",
      points: [
        { x: 500, y: 100, at: "f2" },
        { x: 900, y: 200, at: "a1" },
      ],
    },
  ],
  view: { x: 0, y: 0, w: 1200, h: 1200 },
  infra: { ucg: { on: true, qty: 1 } },
};

/**
 * Old shape: house connection without `gear`, switch still as the point's `model`.
 * The import has to run it through migrateJb().
 */
export const legacyPlan: Plan = {
  name: "Altplan",
  sub: "",
  lang: "de",
  budget: 3000,
  earthwork: 0,
  seq: 3,
  infra: { ucg: { on: true, qty: 1 } },
  items: [
    {
      id: "h1",
      kind: "hub",
      label: "H1",
      x: 100,
      y: 100,
      note: "",
      wan: { type: "fiber", speed: 1000 },
    },
    { id: "as", kind: "jb", model: "flex", label: "S", x: 300, y: 260, note: "" },
    {
      id: "ak",
      kind: "cam",
      model: "g6-bullet",
      label: "K",
      x: 300 + 40 * PX,
      y: 260,
      rot: 0,
      note: "",
    },
  ],
  conduits: [
    {
      id: "af",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "F",
      points: [
        { x: 100, y: 100, at: "h1" },
        { x: 300, y: 260, at: "as" },
      ],
    },
    {
      id: "ac",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "C",
      points: [
        { x: 300, y: 260, at: "as" },
        { x: 300 + 40 * PX, y: 260, at: "ak" },
      ],
    },
  ],
  view: { x: 0, y: 0, w: 1700, h: 1700 },
};

/** Small plan with two elements and one conduit — for sharing and plan switching. */
export const smallPlan: Plan = {
  name: "Kleinplan",
  sub: "Musterdorf",
  lang: "de",
  budget: 3000,
  earthwork: 0,
  seq: 4,
  geo: { ...GEO },
  items: [
    {
      id: "h1",
      kind: "hub",
      label: "H1",
      x: 100,
      y: 100,
      note: "",
      wan: { type: "fiber", speed: 1000 },
    },
    { id: "k1", kind: "cam", model: "g6-bullet", label: "K1", x: 300, y: 200, rot: 0, note: "Tor" },
  ],
  conduits: [
    {
      id: "cc",
      pipe: "dn50",
      ducts: [{ cables: [{ type: "cat", n: 1 }] }],
      label: "Kupfer",
      points: [
        { x: 100, y: 100, at: "h1" },
        { x: 300, y: 200, at: "k1" },
      ],
    },
  ],
  view: { x: 0, y: 0, w: 800, h: 800 },
  infra: { ucg: { on: true, qty: 1 } },
};

/** In tests, Nominatim answers from this canned data, never from the network. */
export const nominatimHits = [
  {
    lat: "50.941357",
    lon: "6.958307",
    display_name: "Musterstraße 1, Musterdorf, Musterkreis, 12345, Musterland",
    address: { road: "Musterstraße", house_number: "1", village: "Musterdorf", postcode: "12345" },
  },
];
