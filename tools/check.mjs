// Checks the planner against its own HTML: both functions are pulled
// from public/planner/index.html, so the check hits the shipped code
// and not a copy of it.
//   angleAt()  — rotation handle angle math, needs no server
//   serverDb() — round trip against /api/state, needs `task serve`
// Usage:  task serve   (in a second terminal)   ocx exec -- task check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const base = process.env.BASE ?? "http://localhost:4321";

const html = readFileSync(new URL("../public/planner/index.html", import.meta.url), "utf8");

function lift(name, head) {
  const re = new RegExp(` {2}${head}${name}\\(.*?\\) \\{[\\s\\S]*?\\n {2}\\}\\n`);
  const src = html.match(re);
  assert.ok(src, `${name}() not found in public/planner/index.html`);
  return new Function(`${src[0]}; return ${name};`)();
}

// --- Rotation handle: angle around the camera centre -------------------------------
const angleAt = lift("angleAt", "function ");

assert.equal(angleAt(0, 0, 10, 0, 0), 0, "0° = east");
assert.equal(angleAt(0, 0, 0, 10, 0), 90, "90° = south (SVG y points down)");
assert.equal(angleAt(0, 0, -10, 0, 0), 180);
assert.equal(angleAt(0, 0, 0, -10, 0), 270, "a negative angle is normalized to 0..359");
assert.equal(angleAt(0, 0, 10, 10, 0), 45);
assert.equal(angleAt(5, 5, 15, 5, 0), 0, "the centre gets subtracted");
assert.equal(angleAt(0, 0, 10, 1, 15), 0, "snap locks to 15°");
assert.equal(angleAt(0, 0, 10, -1, 15), 0, "snap doesn't flip to 354° at -6°");
assert.equal(angleAt(0, 0, -10, -0.5, 15), 180);
for (let d = 0; d < 360; d++) {
  const rad = (d * Math.PI) / 180;
  assert.equal(angleAt(0, 0, Math.cos(rad) * 40, Math.sin(rad) * 40, 0), d, `full sweep at ${d}°`);
}
console.log("ok — angleAt() returns 0..359, snap and full sweep are correct");

// --- Offset paths: the parallels in the trench ------------------------------
// Pipes and cables are drawn as offset polylines, not as a thicker
// stroke. The offset has to be correct everywhere, including at a kink.
const offsetPath = lift("offsetPath", "function ");
{
  // Kink from (0,0) via (100,0) to (100,100): the two carrier lines are y = 0
  // and x = 100. Every offset point must sit exactly d away from one of them,
  // the mitre point from both.
  const bend = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
    d = 6;
  const distTo = (p) => Math.min(Math.abs(p.y), Math.abs(p.x - 100));
  for (const s of [d, -d]) {
    const off = offsetPath(bend, s);
    assert.equal(off.length, 3, "right angle: one mitre, no extra point");
    off.forEach((p) =>
      assert.ok(
        Math.abs(distTo(p) - d) < 1e-9,
        `offset ${s}: distance ${distTo(p)} instead of ${d}`,
      ),
    );
    assert.ok(
      Math.abs(Math.abs(off[1].y) - d) < 1e-9 && Math.abs(Math.abs(off[1].x - 100) - d) < 1e-9,
      "the mitre point keeps its distance to both legs",
    );
  }
  // A sharp point would shoot far out as a mitre — beyond four times the offset it gets bevelled.
  assert.equal(
    offsetPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 1 },
      ],
      d,
    ).length,
    4,
    "a sharp kink gets bevelled",
  );
  assert.deepEqual(
    offsetPath(bend, 0),
    bend.map((p) => ({ x: p.x, y: p.y })),
    "with no offset, the centre path remains",
  );
  assert.equal(
    offsetPath(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      d,
    ).length,
    1,
    "duplicate points are dropped",
  );
}
console.log("ok — offsetPath() offsets polylines with mitre and a mitre limit");

// --- Bonds: conduit ends hanging off a junction ----------------------------
// syncBonds() reads `state`, so it's instantiated with its own state.
{
  const src = html.match(/ {2}function syncBonds\(\) \{[\s\S]*?\n {2}\}\n/);
  assert.ok(src, "syncBonds() not found in public/planner/index.html");
  const make = new Function("state", `${src[0]}; return syncBonds;`);

  const st = {
    items: [{ id: "j1", kind: "jb", x: 100, y: 200 }],
    conduits: [
      {
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 5, at: "j1" },
        ],
      },
      {
        points: [
          { x: 9, y: 9, at: "weg" },
          { x: 1, y: 1 },
        ],
      },
    ],
  };
  make(st)();
  assert.deepEqual(
    st.conduits[0].points[1],
    { x: 100, y: 200, at: "j1" },
    "a bound point follows the junction",
  );
  assert.deepEqual(st.conduits[0].points[0], { x: 0, y: 0 }, "a free point stays put");
  assert.deepEqual(
    st.conduits[1].points[0],
    { x: 9, y: 9 },
    "a binding to a deleted element is dropped",
  );

  st.items[0].x = 300;
  st.items[0].y = 400;
  make(st)();
  assert.deepEqual(st.conduits[0].points[1], { x: 300, y: 400, at: "j1" }, "the point moves along");
}
console.log("ok — syncBonds() carries bound conduit ends along and clears out dead bindings");

// --- The planner starts empty, with no third-party data --------------------
assert.match(
  html,
  /function defaultState\(\)[\s\S]{0,600}items: \[\], conduits: \[\]/,
  "defaultState() must start empty — no sample property",
);
assert.ok(
  !/Flurst\u00fcck \d/i.test(html) &&
    !/[A-Z\u00c4\u00d6\u00dc][a-z\u00e4\u00f6\u00fc]+stra\u00dfe \d|[A-Z\u00c4\u00d6\u00dc][a-z\u00e4\u00f6\u00fc]+ \d+, \d{5}/.test(
      html,
    ),
  "no location-specific data in public/planner/index.html",
);
console.log("ok — default plan is empty, no third-party locations in the shipped state");

// --- Nothing secret in the build -------------------------------------------
// public/ is copied unchanged into dist/client. Whatever lives there is public.
{
  const { existsSync, readdirSync, statSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = new URL("../public", import.meta.url).pathname;
  const walk = (d, out = []) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f, out);
      else out.push(f);
    }
    return out;
  };
  const files = walk(dir);
  const bad = files.filter((f) =>
    /(^|\/)(\.env|\.env\..*|id_rsa.*|.*\.(key|pem|p12|pfx|ppk))$/i.test(f),
  );
  assert.equal(bad.length, 0, `credentials in public/: ${bad.join(", ")}`);
  const envFile = new URL("../.env.local", import.meta.url).pathname;
  if (existsSync(envFile)) {
    const names = readFileSync(envFile, "utf8")
      .split("\n")
      .map((l) => l.split("=")[0].trim())
      .filter(Boolean);
    assert.ok(
      names.every((n) => !/^(PUBLIC_|VITE_)/.test(n)),
      "PUBLIC_/VITE_ in .env.local would be visible in the browser",
    );
  }
}
console.log("ok — nothing secret in public/, .env.local stays server-side");

// --- Snap: a conduit ends at any element, not only at a junction --------
{
  const src = html.match(/ {2}function snapTargets\(\) \{[\s\S]*?\n {2}\}\n/);
  assert.ok(src, "snapTargets() not found");
  const make = new Function("state", `${src[0]}; return snapTargets;`);
  const st = { items: [{ kind: "cam" }, { kind: "ap" }, { kind: "jb" }, { kind: "hub" }] };
  assert.equal(make(st)().length, 4, "conduit ends also snap onto a camera and an AP");
}
console.log("ok — snapTargets() offers every element as a target");

// --- Ortssuche: WGS84 <-> UTM 32N ---------------------------------------
{
  const src = html.match(/ {2}const UTM = \(\(\) => \{[\s\S]*?\n {2}\}\)\(\);\n/);
  assert.ok(src, "UTM conversion not found");
  const UTM = new Function(`${src[0]}; return UTM;`)();
  // Known fixed value: 51°N / 6°E sits in EPSG:25832 at 289511.1 / 5654109.2
  const k = UTM.fwd(51, 6);
  assert.ok(Math.abs(k.e - 289511.14) < 0.5, `easting ${k.e}`);
  assert.ok(Math.abs(k.n - 5654109.2) < 0.5, `northing ${k.n}`);
  // The default origin sits at Cologne Cathedral — no private location in the shipped state
  const ll = UTM.inv(356558.82, 5645281.06);
  assert.ok(
    Math.abs(ll.lat - 50.94129) < 0.001 && Math.abs(ll.lon - 6.95828) < 0.001,
    `${ll.lat} ${ll.lon}`,
  );
  const back = UTM.fwd(ll.lat, ll.lon);
  assert.ok(
    Math.abs(back.e - 356558.82) < 0.01 && Math.abs(back.n - 5645281.06) < 0.01,
    "round trip accurate to a millimetre",
  );
  const geoDefault = html.match(/const GEO_DEFAULT = \{ e0: ([\d.]+), n0: ([\d.]+) \};/);
  assert.ok(geoDefault, "GEO_DEFAULT not found");
  assert.equal(+geoDefault[1], 356448.6, "GEO_DEFAULT.e0 is not Cologne Cathedral");
  assert.equal(+geoDefault[2], 5645366.7, "GEO_DEFAULT.n0 is not Cologne Cathedral");
}
console.log("ok — UTM 32N matches the fixed value and round-trips cleanly");

// --- i18n: every key exists in both languages ----------------------
// t() silently falls back to German; a forgotten English text would
// otherwise only surface to the user.
{
  const src = html.match(/ {2}const T = \{\n[\s\S]*?\n {2}\};\n/);
  assert.ok(src, "text catalogue T not found");
  const T = new Function(`${src[0]}; return T;`)();
  const de = Object.keys(T.de),
    en = Object.keys(T.en);
  const missingEn = de.filter((k) => !(k in T.en));
  const missingDe = en.filter((k) => !(k in T.de));
  assert.deepEqual(missingEn, [], `no English text: ${missingEn.join(", ")}`);
  assert.deepEqual(missingDe, [], `no German text: ${missingDe.join(", ")}`);
  const empty = de.filter((k) => !String(T.de[k]).trim() || !String(T.en[k]).trim());
  assert.deepEqual(empty, [], `empty text: ${empty.join(", ")}`);
  console.log(`ok — ${de.length} text keys, both languages complete`);
}

// --- Amazon links in the catalogue ---------------------------------------------
// An ASIN is ten characters after /dp/. A search link or an affiliate address
// would not be an article — and that's exactly what sneaks in when adding one later.
{
  const urls = [...html.matchAll(/\bamazon: "([^"]*)"/g)].map((m) => m[1]);
  assert.ok(urls.length >= 50, `too few Amazon links in the catalogue: ${urls.length}`);
  const bad = urls.filter((u) => !/^https:\/\/www\.amazon\.de\/dp\/[A-Z0-9]{10}$/.test(u));
  assert.deepEqual(bad, [], `not a /dp/<ASIN> address: ${bad.join(", ")}`);
  assert.equal(new Set(urls).size, urls.length, "every article appears only once");
}
console.log("ok — Amazon links are /dp/<ASIN> addresses");

// --- Gear catalogue: housing or device, never guessed from `power` ---------
// isHousing() used to hinge on power:false. A surge protector, an SFP module and
// a PoE extender need no power and would have become housings that way.
{
  const i = html.indexOf("const JUNCTIONS = {");
  const block = html.slice(i, html.indexOf("\n  };", i));
  const rows = [...block.matchAll(/^ {4}"([a-z0-9-]+)": +\{([^\n]*)/gm)].map((m) => [m[1], m[2]]);
  assert.ok(rows.length >= 27, `too few catalogue entries: ${rows.length}`);
  const noKind = rows.filter(([, head]) => !/kind: "(housing|device)"/.test(head)).map(([k]) => k);
  assert.deepEqual(noKind, [], `without kind: ${noKind.join(", ")}`);
  const keys = rows.map(([k]) => k);
  const want = [
    "shaft-s",
    "cab-l",
    "rack19",
    "cab-sw",
    "pit",
    "tplink-poe170s",
    "usw-flex",
    "eth-sp-g2",
    "tplink-sm311ls",
    "trendnet-tpe-e100",
    "mikrotik-crs305",
    "mikrotik-css610-8g",
    "usw-flex-mini",
    "usw-flex-xg",
    "u-poe-plus-plus",
    "tplink-poe380s",
    "trendnet-ti-pg541i",
    "trendnet-ti-pg102i",
    "tplink-sm321a",
    "tplink-sm321b",
  ];
  const miss = want.filter((k) => !keys.includes(k));
  assert.deepEqual(miss, [], `missing entries: ${miss.join(", ")}`);
  const noWhen = want.filter((k) => !html.includes(`"jb:${k}"`));
  assert.deepEqual(noWhen, [], `without buying guide: ${noWhen.join(", ")}`);
  // SFP cages sit on the data sheet, not guessed from the port count.
  const noSfp = rows
    .filter(([, head]) => /power: true/.test(head) && !/sfpPorts: \d/.test(head))
    .map(([k]) => k);
  assert.deepEqual(noSfp, [], `powered device without sfpPorts: ${noSfp.join(", ")}`);
  // The injector has two jacks, but only one downstream port.
  const inj = rows.find(([k]) => k === "tplink-poe170s")[1];
  assert.match(inj, /ports: 2, sfpPorts: 0, poePorts: 1/, "the injector feeds exactly one device");
  assert.match(
    rows.find(([k]) => k === "trendnet-tpe-e100")[1],
    /extend: 100/,
    "the extender raises the copper limit",
  );
  // Where a device gets its power from sits on the entry — the link.mains
  // finding hangs off that. A housing has none, it's just a location.
  const badIn = rows
    .filter(([, h]) => /kind: "device"/.test(h) && !/powerIn: "(mains|poe|none)"/.test(h))
    .map(([k]) => k);
  assert.deepEqual(badIn, [], `device without a valid powerIn: ${badIn.join(", ")}`);
  const houseIn = rows
    .filter(([, h]) => /kind: "housing"/.test(h) && /powerIn:/.test(h))
    .map(([k]) => k);
  assert.deepEqual(houseIn, [], `housing with powerIn: ${houseIn.join(", ")}`);
  // A device without its own power adapter is still active: `power` says "device",
  // `powerIn` says "from where". That's exactly the USW Flex Mini.
  assert.match(
    rows.find(([k]) => k === "usw-flex-mini")[1],
    /power: true, powerIn: "poe"/,
    "the PoE-powered switch stays an active device",
  );
  // links() checks the power need at the **active** point. A device with a power
  // adapter that doesn't count as active would fall through — none does, and that must stay true.
  const dark = rows
    .filter(([, h]) => /powerIn: "mains"/.test(h) && !/power: true/.test(h))
    .map(([k]) => k);
  assert.deepEqual(dark, [], `device with a power adapter, but power: false: ${dark.join(", ")}`);
}
console.log("ok — every gear entry is a housing or a device, SFP cages sit on the device");

// --- Boot: bring up the whole page in jsdom once ---------------------
{
  const jsdom = await import("jsdom");
  const { JSDOM } = jsdom;
  const errors = [];
  // The planner starts empty, so the test lays down its own state —
  // made up, so no real address travels along here.
  const FIXTURE = {
    name: "Prüfplan",
    sub: "",
    lang: "de",
    budget: 3000,
    earthwork: 12,
    seq: 9,
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
      // Two elements 1 m apart (5.957 px): the map must turn them into a group.
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
      // Ends at Z1 — an element that sits inside the group.
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
      // New shape: every pipe carries its own cables. Third pipe empty.
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
      // Cable without a pipe: no trench, no pipe line, just the strand.
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
      // The oldest shape: a template key plus a cable count. Share links from
      // back then still look like this — migrateConduit() must keep accepting them.
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
      // Two pipe types in one trench: every pipe costs according to its own type.
      // 59.57 px is exactly 10 m — that lets the pipe row be checked by hand.
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
      // Old pipe type "no pipe" — that becomes the cable run's own kind.
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
      // Flat shape with three pipes: every pipe inherits the old pipe type.
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
      // Oldest shape with two cables from the template.
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
    // Without a saved viewport the planner starts at the 2.5 km overview — there
    // the whole test plan would sit in a single group. The test wants the working zoom.
    view: { x: -60, y: -60, w: 620, h: 620 },
    infra: {},
  };
  const dom = new JSDOM(html, {
    url: `${base}/planner`,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    // 'usable' really fetches the dockview bundle from the running server — otherwise
    // the check would only ever test the fallback and never the real layout.
    resources: "usable",
    virtualConsole: new jsdom.VirtualConsole().on("jsdomError", (e) => errors.push(e)),
    beforeParse(win) {
      try {
        // Seeded under the old oh- prefix on purpose: this boot walks the whole chain,
        // migrateKeys() renaming it and migrateLegacy() turning it into a plan of its own.
        win.localStorage.setItem("oh-plan", JSON.stringify(FIXTURE));
        win.localStorage.setItem("oh-spare", "carried over");
        win.localStorage.setItem("oh-taken", "old");
        win.localStorage.setItem("sl-taken", "new");
      } catch {}
    },
  });
  // jsdom doesn't come with a ResizeObserver, but dockview insists on one. Purely
  // a gap in the test environment, it's there in the browser.
  if (!dom.window.ResizeObserver) {
    dom.window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  // jsdom doesn't compute SVG layout; only the mouse needs these two methods.
  // The mapping here is the identity matrix: clientX/clientY are exactly the
  // map units. That way drawing can really be clicked through; events without
  // coordinates still return (0, 0) as before.
  const proto = dom.window.SVGSVGElement.prototype;
  proto.createSVGPoint = function () {
    return {
      x: 0,
      y: 0,
      matrixTransform() {
        return { x: this.x, y: this.y };
      },
    };
  };
  proto.getScreenCTM = function () {
    return { inverse: () => ({}) };
  };

  await new Promise((r) => dom.window.addEventListener("load", r));
  await new Promise((r) => setTimeout(r, 400)); // dockview loads asynchronously as its own script

  const doc = dom.window.document;
  const fire = (elm, type) => elm.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  assert.equal(
    errors.length,
    0,
    `runtime error while booting: ${errors.map((e) => e.message).join(" | ")}`,
  );
  assert.ok(doc.querySelectorAll(".marker.cam").length >= 2, "cameras rendered");
  assert.ok(doc.querySelector(".marker.jb"), "junction rendered");
  assert.ok(doc.querySelectorAll(".conduit").length >= 3, "conduits rendered");
  // A conduit is not a stroke but three layers: trench, pipes, cables — plus
  // a cross-section at the path's midpoint. Otherwise a pipe looks like a cable.
  {
    const c4 = doc.querySelector('#g-conduits g.conduit[data-id="c4"]');
    assert.ok(c4.querySelector("path.trench"), "with a pipe there is a trench");
    assert.equal(c4.querySelectorAll("path.duct").length, 3, "one parallel per pipe");
    assert.equal(c4.querySelectorAll("path.strand").length, 3, "one coloured strand per cable");
    // Every strand carries its pipe: two fibres in pipe 1, the copper in pipe 2.
    const byDuct = [...c4.querySelectorAll("path.strand")].map((p) => [
      p.dataset.duct,
      p.getAttribute("stroke"),
    ]);
    assert.deepEqual(
      byDuct,
      [
        ["0", "var(--accent)"],
        ["0", "var(--accent)"],
        ["1", "var(--ink-3)"],
      ],
      "the strands hang off the pipe their cable lies in",
    );
    const offs = [...c4.querySelectorAll("path.duct")].map((p) => +p.dataset.off);
    assert.ok(offs[0] < offs[1] && offs[1] < offs[2], "the pipe lanes sit side by side");
    // A pipe with two cables gets a wider lane than one with a single cable —
    // but the whole set sits centred on the path.
    const all = [...c4.querySelectorAll("[data-off]")].map((p) => +p.dataset.off);
    assert.ok(
      Math.abs(Math.min(...all) + Math.max(...all)) < 1e-6,
      "the whole set sits centred on the path",
    );
    assert.ok(offs[1] - offs[0] > offs[2] - offs[1], "the pipe with two cables needs more room");
    assert.notEqual(
      c4.querySelector("path.duct").getAttribute("d"),
      c4.querySelector("path.core").getAttribute("d"),
      "the parallel is really offset, not the same path",
    );
    const bad = doc.querySelectorAll('#g-sections g.csection[data-id="c4"]');
    assert.equal(bad.length, 1, "a short conduit gets exactly one cross-section");
    assert.equal(
      bad[0].querySelectorAll("circle.duct").length,
      3,
      "one circle per pipe, side by side",
    );
    const cx = [...bad[0].querySelectorAll("circle.duct")].map((n) => +n.getAttribute("cx"));
    assert.ok(
      cx[0] < cx[1] && cx[1] < cx[2] && Math.abs(cx[1]) < 1e-6,
      "the circles line up around the centre",
    );
    assert.equal(
      bad[0].querySelectorAll("circle.cable").length,
      3,
      "three cable dots in the cross-section",
    );
    assert.ok(
      bad[0].getAttribute("transform").includes("scale("),
      "the cross-section hangs off the screen scale",
    );
    assert.match(
      bad[0].querySelector("title").textContent,
      /Glasfaser/,
      "the hover title names the cables",
    );

    const c5 = doc.querySelector('#g-conduits g.conduit[data-id="c5"]');
    assert.equal(c5.querySelector("path.trench"), null, "without a pipe, no trench is drawn");
    assert.equal(c5.querySelectorAll("path.duct").length, 0, "and no pipe line either");
    assert.equal(c5.querySelectorAll("path.strand").length, 1, "the cable lies bare in the sand");
    assert.equal(
      doc.querySelector('#g-sections g.csection[data-id="c5"] circle.duct'),
      null,
      "then the cross-section has no circle",
    );
    assert.equal(
      doc.querySelectorAll('#g-sections g.csection[data-id="c5"] circle.cable').length,
      1,
      "only the cable dot remains",
    );

    // Spare pipe without cables: dashed pipe line, no strand.
    const c2 = doc.querySelector('#g-conduits g.conduit[data-id="c2"]');
    assert.equal(c2.querySelectorAll("path.strand").length, 0, "an empty pipe has no strand");
    assert.equal(
      c2.querySelector("path.duct").getAttribute("stroke-dasharray"),
      "8 6",
      "and stays dashed",
    );

    // Cross-sections have their own toggle and don't follow the labels.
    const svgEl = doc.getElementById("svg");
    doc.querySelector('#showRow [data-show="labels"]').click();
    assert.ok(svgEl.classList.contains("hide-labels"), "labels off sets hide-labels");
    assert.ok(
      !svgEl.classList.contains("hide-sections"),
      "the cross-sections stay unaffected by it",
    );
    doc.querySelector('#showRow [data-show="labels"]').click();
    doc.querySelector('#showRow [data-show="sections"]').click();
    assert.ok(svgEl.classList.contains("hide-sections"), "cross-sections off sets hide-sections");
    assert.ok(!svgEl.classList.contains("hide-labels"), "and leaves the labels alone");
    assert.match(
      html,
      /\.map\.hide-sections #g-sections \{ display: none/,
      "the CSS rule hides that group on its own",
    );
    doc.querySelector('#showRow [data-show="sections"]').click();
    assert.ok(!svgEl.classList.contains("hide-sections"), "and back on again");

    // Old shapes: the flat cable list moves into pipe 1 — c1 comes as
    // { ducts: 1, cables: [fiber ×2] } from the fixture and must produce two strands in
    // one pipe. Same for the oldest { type, cables: <number> }.
    const c1 = doc.querySelector('#g-conduits g.conduit[data-id="c1"]');
    assert.equal(c1.querySelectorAll("path.duct").length, 1, "one pipe from the flat shape");
    assert.deepEqual(
      [...c1.querySelectorAll("path.strand")].map((p) => p.dataset.duct),
      ["0", "0"],
      "both fibres lie in pipe 1",
    );
    const cold = doc.querySelector('#g-conduits g.conduit[data-id="cold"]');
    assert.equal(cold.querySelectorAll("path.duct").length, 1, "the oldest shape gets one pipe");
    assert.deepEqual(
      [...cold.querySelectorAll("path.strand")].map((p) => p.getAttribute("stroke")),
      ["var(--accent)"],
      "and its template supplies the fibre",
    );

    // Trench vs. cable run: the trench carries pipes of their own type, the cable run
    // neither trench nor pipe — and old shapes land in exactly one of the two kinds.
    const cmix = doc.querySelector('#g-conduits g.conduit[data-id="cmix"]');
    assert.ok(cmix.querySelector("path.trench"), "a trench stays a trench");
    assert.equal(cmix.querySelectorAll("path.duct").length, 2, "two pipes, two parallels");
    const cbare = doc.querySelector('#g-conduits g.conduit[data-id="cbare"]');
    assert.equal(cbare.querySelector("path.trench"), null, "a cable run has no trench");
    assert.equal(cbare.querySelectorAll("path.duct").length, 0, "and no pipe line");
    assert.equal(
      cbare.querySelectorAll("path.strand").length,
      2,
      "both cables lie in the same bundle",
    );
    const c63 = doc.querySelector('#g-conduits g.conduit[data-id="c63"]');
    assert.equal(c63.querySelectorAll("path.duct").length, 3, "the flat shape becomes three pipes");
    const cold2 = doc.querySelector('#g-conduits g.conduit[data-id="cold2"]');
    assert.deepEqual(
      [...cold2.querySelectorAll("path.strand")].map((p) => p.getAttribute("stroke")),
      ["var(--accent)", "var(--accent)"],
      "the oldest shape brings both fibres along",
    );

    // Long route: one cross-section isn't enough. Zooming in adds more,
    // zooming out removes them again — that's computed on zoom, not in the state.
    const nSec = () => doc.querySelectorAll('#g-sections g.csection[data-id="c4"]').length;
    assert.equal(nSec(), 1, "short on screen: just the one at the centre");
    for (let i = 0; i < 4; i++) doc.getElementById("z-in").click();
    assert.ok(nSec() >= 3, `zoomed in, several sit on the route (${nSec()})`);
    const xs = [...doc.querySelectorAll('#g-sections g.csection[data-id="c4"]')]
      .map((n) => +n.dataset.sx)
      .sort((a, b) => a - b);
    assert.ok(
      Math.abs((xs[0] + xs[xs.length - 1]) / 2 - 180) < 1,
      "and they sit symmetrically around the route's centre",
    );
    for (let i = 0; i < 4; i++) doc.getElementById("z-out").click();
    assert.equal(nSec(), 1, "zoomed back out, there's one again");
  }
  assert.ok(doc.getElementById("cat-q"), "catalogue search present");
  assert.ok(doc.querySelectorAll("#cat-chips .chip").length >= 8, "filter badges present");
  assert.ok(doc.querySelectorAll("#cat-cams .item").length >= 9, "camera catalogue populated");
  assert.equal(doc.querySelectorAll("#cat-tabs .seg").length, 5, "catalogue has its own ribbon");
  assert.equal(doc.querySelectorAll("#pane-build .cat").length, 1, "only one category at a time");
  // Explanatory text sits in the dialog, not the panel
  assert.ok(
    !/Ein Abzweigpunkt ist ein Ort mit einem Gehäuse/.test(
      doc.getElementById("pane-build").textContent,
    ),
    "no body text in the Build panel",
  );
  doc.getElementById("cat-info").click();
  assert.match(
    doc.getElementById("infoBody").textContent,
    /Sichtfeld|field of view/,
    "the info dialog explains the tab",
  );
  doc.getElementById("infoClose").click();

  // Layout: dockview takes over the area, every panel really hangs inside it
  assert.equal(typeof dom.window["dockview-core"], "object", "dockview bundle loaded");
  assert.ok(!doc.getElementById("dock").classList.contains("plainlayout"), "no fallback needed");
  assert.ok(doc.querySelector("#dock .dv-dockview"), "dockview has taken over the area");
  assert.ok(doc.querySelectorAll("#dock .dv-tab").length >= 4, "panel tabs present");
  // The map and active panels hang in the layout; dockview temporarily takes
  // inactive tabs out of the document — so it's enough to fetch them via the tabs.
  ["mapwrap", "pane-build"].forEach((id) => {
    assert.ok(
      doc.getElementById("dock").contains(doc.getElementById(id)),
      `${id} hangs in the layout`,
    );
  });
  assert.ok(doc.querySelectorAll("#dock .dv-tab").length >= 4, "tabs for every panel present");

  // dockview only attaches the currently visible panel of a group into the document.
  // The view menu activates one — the user takes the same path.
  const menu = doc.getElementById("viewMenu");
  const activate = (re) => {
    menu.open = true;
    menu.dispatchEvent(new dom.window.Event("toggle"));
    const entry = [...doc.querySelectorAll("#viewList button")].find((b) => re.test(b.textContent));
    assert.ok(entry, `menu entry for ${re}`);
    entry.click();
    return entry;
  };

  // The view menu lists every panel plus a reset
  menu.open = true;
  menu.dispatchEvent(new dom.window.Event("toggle"));
  const entries = [...doc.querySelectorAll("#viewList button")];
  assert.ok(entries.length >= 6, "menu lists the panels and a reset");
  assert.ok(
    entries.filter((b) => !b.classList.contains("off")).length >= 5,
    "every panel is there",
  );
  activate(/Elemente|Elements/);
  // The panel now hangs in the document — and had already been populated before,
  // even though dockview had detached it. That's exactly what used to go wrong.
  const listPane = doc.getElementById("pane-list");
  assert.ok(listPane && doc.getElementById("dock").contains(listPane), "panel reattached");
  assert.ok(
    listPane.querySelectorAll(".lrow").length >= 8,
    "the list was populated even while detached",
  );
  assert.match(
    doc.getElementById("pane-sel").textContent,
    /Nichts ausgewählt/,
    "placeholder with nothing selected",
  );

  // Switch language — the button shows the active language
  assert.equal(doc.getElementById("t-lang").textContent, "DE");
  activate(/^.Bauen$|Bauen/);
  assert.match(doc.getElementById("pane-build").textContent, /Kameras/);
  doc.getElementById("t-lang").click();
  assert.equal(doc.documentElement.lang, "en");
  assert.equal(doc.getElementById("t-lang").textContent, "EN");
  assert.match(doc.getElementById("pane-build").textContent, /Cameras/);
  doc.getElementById("t-lang").click();

  // Selection lands in its own panel
  activate(/Elemente/);
  doc
    .querySelector("#l-cams .lrow")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  // The panel now only carries fields, finding and lists — the data sheet sits behind the ⓘ.
  assert.equal(
    doc.querySelector("#pane-sel .product"),
    null,
    "no product box in the selection panel",
  );
  assert.ok(doc.querySelector("#pane-sel .selhead #f-del"), "remove sits in the header row");
  assert.ok(doc.querySelector("#pane-sel .selhead #f-dup"), "duplicate sits in the header row");
  doc
    .getElementById("f-modeli")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.match(
    doc.getElementById("infoHead").textContent,
    /G6/,
    "the ⓘ next to the model opens its data sheet",
  );
  assert.ok(doc.querySelector("#infoBody .spec dd.ok, #infoBody .spec dd.warn"), "specs are rated");
  const plink = doc.querySelector("#infoBody .plink");
  assert.match(
    plink.getAttribute("href"),
    /eu\.store\.ui\.com\/eu\/en\/category\/[a-z0-9-]+\/products\/[a-z0-9-]+$/,
    "direct product link",
  );
  assert.ok(doc.querySelector("#infoBody .pbar .plink[href]"), "product page linked");
  const pick = doc.querySelector("#infoBody .shopsel .pick");
  assert.ok(pick && pick.options.length >= 5, "dealers to pick from");
  const goLink = doc.querySelector("#infoBody .shopsel a.go");
  pick.value = "Geizhals";
  fire(pick, "change");
  assert.match(goLink.getAttribute("href"), /geizhals/i, "the search button follows the pick");
  assert.equal(
    doc.querySelector("#infoBody .plink.amz"),
    null,
    "no separate Amazon button anymore",
  );
  assert.match(
    [...pick.options].find((o) => o.value === "Amazon").textContent,
    /^Amazon/,
    "Amazon is in the dealer list",
  );
  pick.value = "Amazon";
  fire(pick, "change");
  assert.match(
    goLink.getAttribute("href"),
    /^https:\/\/www\.amazon\.de\/dp\/[A-Z0-9]{10}$/,
    "and goes straight to the checked article",
  );
  pick.value = "Geizhals";
  fire(pick, "change");
  // Product image can be opened large
  const zoomUp = doc.querySelector("#infoBody .shotbox .zoomup");
  assert.ok(zoomUp, "magnifier on the product image");
  zoomUp.click();
  assert.equal(
    doc.getElementById("imgBig").getAttribute("src"),
    zoomUp.getAttribute("data-imgfull"),
    "the dialog shows the same image",
  );
  doc.getElementById("imgIn").click();
  assert.ok(doc.getElementById("imgBig").style.width.endsWith("%"), "zooming in sets a width");
  doc.getElementById("imgFit").click();
  assert.equal(doc.getElementById("imgBig").style.width, "", "fit removes it again");
  doc.getElementById("imgClose").click();

  // Point handles of a selected conduit sit above the markers, otherwise they're
  // not grabbable under a camera
  activate(/Elemente/);
  doc
    .querySelector("#l-conds .lrow")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  const handles = doc.querySelectorAll("#g-handles .vtx");
  assert.ok(handles.length >= 2, "point handles drawn");
  assert.equal(
    doc.querySelectorAll("#g-conduits .vtx").length,
    0,
    "and no longer in the conduit group",
  );
  const order = [...doc.querySelector("#svg").children].map((g) => g.id);
  assert.ok(
    order.indexOf("g-handles") > order.indexOf("g-markers"),
    "handles sit above the markers",
  );

  // Symbols stay screen-sized: zooming only reapplies the scale in the transform —
  // it doesn't redraw the map. That's why the same node stays put.
  const vbW = () => +doc.getElementById("svg").getAttribute("viewBox").split(/\s+/)[2];
  const scaleOf = (elm) => +/scale\(([-\d.]+)\)/.exec(elm.getAttribute("transform"))[1];
  const firstMarker = () => doc.querySelector("#g-markers .marker");
  {
    const m0 = firstMarker(),
      s0 = scaleOf(m0),
      w0 = vbW(),
      n0 = doc.querySelectorAll("#g-markers .marker").length;
    doc.getElementById("z-out").click();
    assert.ok(vbW() > w0 * 1.3, "z-out widens the viewport");
    assert.equal(
      doc.querySelector("#g-markers .marker"),
      m0,
      "zooming doesn't swap out the marker node",
    );
    assert.ok(scaleOf(m0) > s0, `marker scale follows the zoom (${s0} -> ${scaleOf(m0)})`);
    assert.equal(
      doc.querySelectorAll("#g-markers .marker").length,
      n0,
      "same number of markers as before",
    );
    assert.ok(doc.querySelector("#g-labels [data-sx]"), "conduit labels hang off the scale");
    doc.getElementById("z-in").click();
    assert.ok(Math.abs(scaleOf(firstMarker()) - s0) < 1e-3, "back to the same scale");
  }

  // Two elements 1 m apart are one point at this scale: the map collapses
  // them into a group. Clicking it zooms in, then they split apart again.
  {
    const cl = doc.querySelector("#g-markers .marker.cluster");
    assert.ok(cl, "elements lying close together become a group");
    assert.equal(doc.querySelectorAll("#g-markers .marker.cluster").length, 1, "into exactly one");
    assert.equal(
      cl.querySelector("text").textContent,
      "2",
      "the number in the circle is the count",
    );
    assert.equal(cl.querySelectorAll(".ring").length, 2, "one colour segment per kind contained");
    // Readable on both a light and dark background: a dark fill from its own token,
    // which unlike --ink doesn't flip to light grey in dark mode.
    assert.match(
      html,
      /\.marker\.cluster circle\.body \{ fill: var\(--cluster\); stroke: #fff; stroke-width: 2\.5;/,
      "group circle filled dark, outlined white",
    );
    assert.match(html, /--cluster: #1f2430;/, "and the token doesn't flip with the theme");
    assert.match(
      html,
      /\.marker\.cluster text \{ font-size: calc\(12px \* var\(--look-font\)\); font-weight: 700;/,
      "the number inside is larger and bold and follows the font slider",
    );
    // A gap remains between two segments — otherwise the colours run into each other.
    const arcs = [...cl.querySelectorAll("path.ring")].map((n) => n.getAttribute("d"));
    const endOf = (d) => d.split(/\s+/).slice(-2).map(Number);
    const startOf = (d) => d.slice(1).trim().split(/\s+/).slice(0, 2).map(Number);
    assert.ok(
      Math.hypot(...endOf(arcs[0]).map((v, i) => v - startOf(arcs[1])[i])) > 0.5,
      "the segments don't touch each other",
    );
    assert.equal(
      doc.querySelector('#g-markers .marker[data-id="z1"]'),
      null,
      "members get no marker of their own",
    );
    assert.ok(doc.querySelector('.cone[data-id="z1"]'), "their field of view stays put regardless");
    // A conduit ending at a group member is drawn out to the group —
    // otherwise its stroke would hang in the air next to the circle.
    const czd = doc
      .querySelector('#g-conduits g.conduit[data-id="cz"] path.core')
      .getAttribute("d");
    const czEnd = czd.split("L").pop().trim().split(/\s+/).map(Number);
    assert.ok(
      Math.abs(czEnd[0] - (360 + 365.96) / 2) < 0.01 && Math.abs(czEnd[1] - 60) < 0.01,
      `conduit end sits at the group centre, not the real point: ${czEnd}`,
    );
    assert.ok(
      Math.abs(czEnd[0] - 360) > 1,
      "the real point lies elsewhere — it really is the centre",
    );
    const czStart = czd.slice(1).split("L")[0].trim().split(/\s+/).map(Number);
    assert.deepEqual(czStart, [300, 260], "the other end hangs off no group and stays put");
    const w0 = vbW();
    cl.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true }));
    assert.ok(vbW() < w0, "clicking the group zooms in");
    assert.equal(
      doc.querySelector("#g-markers .marker.cluster"),
      null,
      "and the group splits apart",
    );
    assert.ok(
      doc.querySelector('#g-markers .marker[data-id="z1"]'),
      "the members stand on their own again",
    );
    doc.getElementById("z-fit").click();
    await new Promise((r) => setTimeout(r, 200)); // groups are checked debounced after zooming
  }

  // The house connection is not a special case: far enough out it joins the group too,
  // otherwise it would sit half under its circle. Only the selection stays on its own.
  {
    for (let i = 0; i < 6; i++) doc.getElementById("z-out").click();
    await new Promise((r) => setTimeout(r, 250));
    const ids = [...doc.querySelectorAll("#g-markers .marker.cluster")]
      .map((c) => c.getAttribute("data-ids"))
      .join(" ");
    assert.match(ids, /\bhub\b/, "the house connection joins the group too");
    assert.equal(
      doc.querySelectorAll("#g-markers .marker.hub").length,
      0,
      "and then gets no marker of its own",
    );
    doc.getElementById("z-fit").click();
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(
      doc.querySelector("#g-markers .marker.hub"),
      "at the working zoom it stands on its own again",
    );
  }

  // --- Appearance: the gear icon under the eye ---------------------------
  // Look and feel runs through factors and CSS variables, never through rebuilding the map.
  {
    const svgEl = doc.getElementById("svg");
    const lookMenu = doc.getElementById("lookMenu");
    assert.ok(doc.getElementById("lookPanel"), "the appearance panel sits in the zoom column");
    assert.ok(!lookMenu.classList.contains("open"), "it starts collapsed");
    doc.getElementById("lookBtn").click();
    assert.ok(lookMenu.classList.contains("open"), "the gear icon opens it");
    assert.equal(
      doc.getElementById("lookBtn").getAttribute("aria-expanded"),
      "true",
      "and reports that too",
    );

    // Symbol size: it lives in the transform's factor, the node stays put.
    const factor = (n) => +(/scale\(([\d.]+)\)/.exec(n.getAttribute("transform")) || [])[1];
    const marker = doc.querySelector("#g-markers .marker");
    const before = factor(marker);
    const slide = (id, v) => {
      const e = doc.getElementById(id);
      e.value = String(v);
      e.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      e.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    };
    slide("look-size", 1.4);
    assert.equal(doc.querySelector("#g-markers .marker"), marker, "the marker node isn't rebuilt");
    assert.ok(
      Math.abs(factor(marker) / before - 1.4) < 1e-3,
      `symbol size is a factor on the scale (${before} -> ${factor(marker)})`,
    );
    assert.equal(
      doc.getElementById("look-size-v").textContent,
      "1,4",
      "the value sits next to the slider",
    );

    // Font, areas and stroke width are CSS variables on the SVG — they travel with
    // the clone into image export and the print sheet.
    slide("look-alpha", 0.3);
    assert.equal(
      svgEl.style.getPropertyValue("--look-alpha"),
      "0.3",
      "opacity sits as a variable on the SVG",
    );
    assert.match(
      html,
      /#g-cover \{ opacity: var\(--look-alpha\); \}/,
      "and every area hangs off it",
    );
    // renderPng() clones exactly this SVG — the variables must sit on the clone,
    // otherwise the image shows something different from the map.
    assert.equal(
      svgEl.cloneNode(true).style.getPropertyValue("--look-alpha"),
      "0.3",
      "the clone for image export and PDF carries the appearance along",
    );
    slide("look-font", 1.3);
    assert.equal(svgEl.style.getPropertyValue("--look-font"), "1.3", "font size likewise");
    assert.match(
      html,
      /\.clabels text \{ font-family: var\(--mono\); font-size: calc\(10px \* var\(--look-font\)\)/,
      "the conduit labels compute with it",
    );
    slide("look-line", 1.5);
    assert.equal(svgEl.style.getPropertyValue("--look-line"), "1.5", "conduit width likewise");
    assert.match(
      doc.querySelector("#g-conduits path.strand").getAttribute("style"),
      /var\(--look-line\)/,
      "every conduit layer multiplies its width by it",
    );

    // Turn groups off: far out, every marker still stands on its own regardless.
    for (let i = 0; i < 6; i++) doc.getElementById("z-out").click();
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(
      doc.querySelector("#g-markers .marker.cluster"),
      "with groups on, they collapse together far out",
    );
    const cb = doc.getElementById("look-cluster");
    cb.checked = false;
    cb.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    assert.equal(
      doc.querySelector("#g-markers .marker.cluster"),
      null,
      "without groups there is no group marker",
    );
    assert.equal(
      doc.querySelectorAll("#g-markers .marker").length,
      9,
      "instead every element stands on its own",
    );

    // Reset restores everything to the default — and the groups too.
    doc.getElementById("look-reset").click();
    assert.equal(svgEl.style.getPropertyValue("--look-alpha"), "1", "reset clears the sliders");
    assert.equal(doc.getElementById("look-size").value, "1", "symbol size is back to 1");
    assert.ok(cb.checked, "the group toggle is back on");
    doc.getElementById("z-fit").click();
    await new Promise((r) => setTimeout(r, 250));
    // One value stays changed: the saved plan must carry it (see below).
    slide("look-font", 1.2);
    doc.getElementById("lookBtn").click();
    assert.ok(!lookMenu.classList.contains("open"), "a second click closes it again");
  }

  // View jumps land in the browser history; panning and zooming don't.
  {
    const vb = () => doc.getElementById("svg").getAttribute("viewBox").split(/\s+/).map(Number);
    const wheelLen = dom.window.history.length;
    doc.getElementById("z-in").click();
    assert.equal(dom.window.history.length, wheelLen, "zooming alone adds no history entry");
    activate(/Elemente/);
    const jumpTo = (label) => {
      const r = [...doc.querySelectorAll("#pane-list .lrow")].find(
        (x) => x.querySelector(".b").textContent.trim() === label,
      );
      assert.ok(r, `row for ${label}`);
      r.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    };
    jumpTo("K2"); // go here first, so the second jump really lands somewhere else
    const [bx, by, bw, bh] = vb();
    const len0 = dom.window.history.length;
    jumpTo("S2");
    assert.ok(dom.window.history.length > len0, "a jump adds an entry");
    assert.notEqual(vb()[0], bx, "and shifts the viewport");
    dom.window.dispatchEvent(
      new dom.window.PopStateEvent("popstate", {
        state: { slView: { x: bx, y: by, w: bw, h: bh } },
      }),
    );
    assert.ok(
      Math.abs(vb()[0] - bx) < 0.01 && Math.abs(vb()[2] - bw) < 0.01,
      "back restores the previous view",
    );
    // An entry with no view (foreign state, a share link) is left alone.
    const keep = vb()[0];
    dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate", { state: null }));
    assert.equal(vb()[0], keep, "popstate without slView leaves the map alone");
    doc.getElementById("z-fit").click();
    await new Promise((r) => setTimeout(r, 250));
  }
  activate(/Elemente/);
  doc
    .querySelector("#l-cams .lrow")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

  // Map base layer: tiles on a fixed grid, so the browser cache kicks in
  // The prefetch (applyBasemap("view"), 500 ms after the last movement) lays a ring
  // around the viewport — only then are there neighbouring tiles whose seam can be measured.
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(doc.querySelectorAll("#layerRow [data-bm]").length, 2, "only the two WMS layers");
  // data-url is the requested address; href then possibly points at the cache blob.
  const tiles = () =>
    [...doc.querySelectorAll("#g-tiles image")].map(
      (i) => i.getAttribute("data-url") || i.getAttribute("href"),
    );
  assert.ok(tiles().length >= 1, "tiles drawn");
  assert.ok(doc.querySelector("#g-tiles g[data-z]"), "tiles sit at one zoom level");
  assert.ok(
    tiles().every((h) => /wms_nw_dop/.test(h)),
    "starts on the aerial imagery",
  );
  assert.ok(
    tiles().every((h) => /CRS=EPSG:25832/.test(h)),
    "UTM 32",
  );
  assert.ok(
    tiles().every((h) => /WIDTH=(\d+)&HEIGHT=\1/.test(h)),
    "square tiles",
  );
  assert.ok(
    tiles().every((h) => /FORMAT=image\/jpeg/.test(h)),
    "aerial imagery as JPEG, not PNG",
  );
  // Tile grid: the BBOX edges are multiples of the tile size, otherwise nothing caches
  const box = tiles()[0]
    .match(/BBOX=([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)/)
    .slice(1)
    .map(Number);
  const side = box[2] - box[0];
  assert.ok(Math.abs(box[3] - box[1] - side) < 0.01, "tiles are square");
  assert.ok(Math.abs(box[0] / side - Math.round(box[0] / side)) < 1e-6, "BBOX snaps to the grid");
  assert.ok(Math.abs(box[1] / side - Math.round(box[1] / side)) < 1e-6, "BBOX snaps to the grid");
  // Seams: neighbouring tiles must overlap, otherwise the browser paints both
  // sides of the shared edge at half opacity and --ground flashes through between them.
  // The margin stays tiny (about half a screen pixel), otherwise the
  // transparent ALKIS lines double up.
  let seamChecked = 0;
  for (const g of doc.querySelectorAll("#g-tiles g[data-z], #g-overlay g[data-z]")) {
    const rects = [...g.querySelectorAll("image")].map((i) =>
      ["x", "width", "height"].map((a) => Number(i.getAttribute(a))),
    );
    const xs = [...new Set(rects.map((r) => r[0]))].sort((a, b) => a - b);
    if (xs.length < 2) continue; // one column: no neighbour to compare against
    const step = Math.min(...xs.slice(1).map((x, i) => x - xs[i]));
    assert.ok(
      rects.every((r) => Math.abs(r[1] - r[2]) < 1e-6),
      "tiles stay square",
    );
    assert.ok(
      rects.every((r) => r[1] > step),
      "tiles overlap their neighbours (the seam)",
    );
    assert.ok(
      rects.every((r) => r[1] - step < step / 256),
      "the overlap stays a hairline",
    );
    seamChecked++;
  }
  assert.ok(seamChecked >= 1, "at least one zoom level checked for the tile seam");

  // Panning must not re-request tiles already loaded
  const before = new Set(tiles());
  doc.getElementById("z-in").click();
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(tiles().length >= 1, "tiles are there after zooming");
  doc.getElementById("z-fit").click();
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(
    tiles().some((h) => before.has(h)),
    "back on the property, they're the same tiles",
  );
  assert.equal(doc.getElementById("attrib").hidden, false, "attribution visible");
  // Tile bookkeeping: every drawn tile knows its own address, and no
  // address appears twice at the same zoom level. Otherwise grey holes appear.
  for (const g of doc.querySelectorAll("#g-tiles g[data-z]")) {
    const urls = [...g.querySelectorAll("image")].map((i) => i.getAttribute("data-url"));
    assert.ok(urls.every(Boolean), "every tile knows its address");
    assert.equal(new Set(urls).size, urls.length, "no tile appears twice at one zoom level");
  }

  // A click on the layer picker must not start panning
  doc
    .getElementById("layerMenu")
    .dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true }));
  assert.ok(
    !doc.getElementById("mapwrap").classList.contains("panning"),
    "controls don't start panning",
  );

  doc.querySelector('#layerRow [data-bm="alkis"]').click();
  assert.ok(
    tiles().every((h) => /wms_nw_alkis/.test(h)),
    "switching layers clears out the old tiles",
  );
  doc.querySelector('#layerRow [data-bm="dop"]').click();

  // Catalogue search filters
  activate(/Bauen/);
  const q = doc.getElementById("cat-q");
  q.value = "ptz";
  fire(q, "input");
  assert.equal(
    doc.querySelectorAll("#cat-cams .item").length,
    2,
    'searching "ptz" leaves the two PTZ models (UniFi, Reolink)',
  );
  q.value = "reolink";
  fire(q, "input");
  assert.equal(
    doc.querySelectorAll("#cat-cams .item").length,
    8,
    "searching by manufacturer finds every Reolink model",
  );
  q.value = "ptz";
  fire(q, "input"); // state for the later reload check

  // Clicking in the catalogue doesn't rebuild the panel — otherwise the scrollbar
  // would jump to the top on every selection.
  activate(/Bauen/);
  const buildPane = doc.getElementById("pane-build");
  buildPane.dataset.probe = "x";
  const camBtn = doc.querySelector("#cat-cams .item");
  camBtn.click();
  assert.equal(doc.getElementById("pane-build"), buildPane, "the Build panel stays the same node");
  assert.equal(buildPane.dataset.probe, "x", "panel content isn't discarded");
  assert.equal(
    doc.querySelector("#cat-cams .item"),
    camBtn,
    "catalogue buttons stay the same nodes",
  );
  assert.equal(camBtn.getAttribute("aria-pressed"), "true", "a pressed button is only flagged");
  doc.getElementById("t-select").click();

  // Selection panel: same selection = same DOM, so no flicker
  activate(/Elemente/);
  doc
    .querySelector("#l-cams .lrow")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  const selHead = doc.querySelector("#pane-sel h2");
  const noteBox = doc.getElementById("f-note");
  noteBox.value = "Prüfnotiz";
  fire(noteBox, "change");
  assert.equal(doc.querySelector("#pane-sel h2"), selHead, "the header row stays put");
  assert.equal(doc.getElementById("f-note"), noteBox, "input fields aren't rebuilt");

  // Conduit: one block per pipe with its cables, quantities individually adjustable
  activate(/Elemente/);
  doc
    .querySelector("#l-conds .lrow")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(doc.getElementById("f-kind").value, "trench", "a trench is the default kind");
  assert.ok(doc.getElementById("f-duct-pipe-0"), "pipe type selectable per pipe");
  assert.equal(doc.querySelectorAll("#f-ducts .duct").length, 1, "one block per pipe");
  assert.equal(doc.getElementById("f-cab-0-0").value, "2", "pipe 1 carries two fibres");
  // Data sheet of the cable: the row and the add row carry the same ⓘ
  doc
    .getElementById("f-cabi-0-0")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.match(
    doc.getElementById("infoHead").textContent,
    /Glasfaser/,
    "the ⓘ on the cable row opens the data sheet",
  );
  assert.match(
    doc.getElementById("infoBody").textContent,
    /je Kabel/,
    "with the full text and the fixed costs",
  );
  doc.getElementById("infoClose").click();
  const csel = doc.getElementById("f-cab-new-0");
  csel.value = "cat";
  doc
    .getElementById("f-cabi-new-0")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.match(
    doc.getElementById("infoHead").textContent,
    /Cat6A/,
    "and the add row's ⓘ shows that of the picked cable",
  );
  doc.getElementById("infoClose").click();
  const total = () => doc.getElementById("totalChip").textContent;
  const t0 = total();
  doc
    .getElementById("f-duct-add")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  const t1 = total();
  assert.equal(doc.querySelectorAll("#f-ducts .duct").length, 2, "one more pipe, one more block");
  assert.notEqual(t1, t0, "two pipes in a trench cost more than one");
  assert.equal(doc.querySelectorAll("#f-cabs-1 .cabrow").length, 0, "the new pipe is empty");
  assert.equal(doc.getElementById("f-duct-pipe-1").value, "dn50", "and comes in as DN 50");

  // Undo/redo via the keyboard
  const key = (k, mod) =>
    doc.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: k,
        ctrlKey: true,
        shiftKey: !!mod,
        bubbles: true,
      }),
    );
  key("z");
  assert.equal(total(), t0, "Ctrl+Z undoes the change");
  key("y");
  assert.equal(total(), t1, "Ctrl+Y redoes it");
  key("z");
  assert.equal(total(), t0, "and back again");
  assert.equal(doc.getElementById("t-undo").disabled, false, "the undo button is live");

  // --- Kind of conduit: trench with pipes vs. a cable run without a pipe ---------
  const pickCond = (label) => {
    activate(/Elemente/);
    const r = [...doc.querySelectorAll("#l-conds .lrow")].find((x) =>
      x.querySelector(".t").textContent.startsWith(label),
    );
    assert.ok(r, `conduit row for ${label}`);
    r.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  };
  const cstat = () => [...doc.querySelectorAll("#f-cstats dd")].map((n) => n.textContent.trim());
  // Two pipes, two types, 10 m: 10 × 1.60 € + 10 × 2.20 € = 38 €.
  pickCond("1 × Leerrohr DN 50");
  assert.equal(doc.getElementById("f-duct-pipe-0").value, "dn50", "pipe 1 is a DN 50");
  assert.equal(
    doc.getElementById("f-duct-pipe-1").value,
    "dn63",
    "pipe 2 a DN 63 — every pipe has its own type",
  );
  assert.match(cstat()[1], /^38 €/, "every pipe costs according to its own type");
  assert.match(cstat()[1], /DN 50.*DN 63/, "the pipe row counts per type");
  assert.match(cstat()[4], /^120 €/, "the trench costs earthwork");
  assert.match(
    doc.getElementById("f-clabel").value,
    /DN 50.*DN 63/,
    "and the name names both pipes",
  );

  // Cable run: just the cable list, no pipe, no earthwork.
  pickCond("Kabelzug");
  assert.equal(
    doc.getElementById("f-kind").value,
    "cable",
    'the old pipe type "no pipe" is now a cable run',
  );
  assert.equal(doc.getElementById("f-duct-pipe-0"), null, "there is no pipe type there");
  assert.equal(doc.getElementById("f-duct-add"), null, 'and no "add pipe"');
  assert.equal(doc.getElementById("f-cab-0-0").value, "2", "the two Cat6A lie in one bundle");
  assert.equal(cstat()[1], "–", "a cable run has no pipe costs");
  assert.equal(cstat()[4], "–", "and no earthwork");

  // Switching to a trench: a DN 50 pipe wraps around it, the cables stay.
  const setCLabel = (v) => {
    const e = doc.getElementById("f-clabel");
    e.value = v;
    fire(e, "change");
  };
  setCLabel("2 × Cat6A (ohne Rohr)"); // exactly the automatic name
  const kindSel = doc.getElementById("f-kind");
  kindSel.value = "trench";
  fire(kindSel, "change");
  assert.equal(
    doc.querySelectorAll("#f-ducts .duct").length,
    1,
    "the bundle becomes exactly one pipe",
  );
  assert.equal(doc.getElementById("f-duct-pipe-0").value, "dn50", "namely a DN 50");
  assert.equal(doc.getElementById("f-cab-0-0").value, "2", "the cables are preserved");
  assert.match(
    doc.getElementById("f-clabel").value,
    /^Leerrohr DN 50 \+ 2 × Cat6A$/,
    "the name follows along",
  );
  key("z"); // conduit stays as it was

  // Points: two clicks on a point remove it, two on the pipe add one.
  // The planner counts them itself — the browser delivers no dblclick if a
  // redraw happened between the two clicks.
  activate(/Elemente/);
  doc
    .querySelector("#l-conds .lrow")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  const vtx = () => doc.querySelectorAll("#g-handles .vtx").length;
  const tap = (el) =>
    el.dispatchEvent(
      new dom.window.MouseEvent("pointerdown", { bubbles: true, clientX: 40, clientY: 40 }),
    );
  const n0 = vtx();
  assert.ok(n0 >= 4, "enough points to test with");
  tap(doc.querySelectorAll("#g-handles .vtx")[1]);
  tap(doc.querySelectorAll("#g-handles .vtx")[1]);
  assert.equal(vtx(), n0 - 1, "a double click on the point removes it");
  tap(doc.querySelector(".conduit.selected .core"));
  tap(doc.querySelector(".conduit.selected .core"));
  assert.equal(vtx(), n0, "a double click on the pipe adds a new point");
  key("z");
  key("z");

  // House node: place, pick a connection type and tier, remove again
  const hubs = () => doc.querySelectorAll("#g-markers .marker.hub").length;
  const hub0 = hubs();
  doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "h", bubbles: true }));
  assert.equal(
    doc.getElementById("t-hub").getAttribute("aria-pressed"),
    "true",
    "house tool via H",
  );
  doc
    .getElementById("mapwrap")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(hubs(), hub0 + 1, "the house node is placed");
  assert.equal(doc.querySelectorAll("#f-speed option").length, 5, "fibre has five tiers");
  const wanSel = doc.getElementById("f-wan");
  wanSel.value = "dsl";
  fire(wanSel, "change");
  assert.equal(doc.querySelectorAll("#f-speed option").length, 4, "DSL has four tiers");
  assert.equal(doc.getElementById("f-speed").value, "50", "the highest DSL tier as default");
  doc.getElementById("f-del").click();
  assert.equal(hubs(), hub0, "the house node can be deleted");

  // Switches sit on the map and aren't counted again in the infrastructure
  activate(/Elemente/);
  assert.ok(doc.querySelectorAll("#l-jbs .lrow").length >= 3, "junction and gear in the list");
  // Old shape: the switch used to sit as `model` on the point. Now it's a device inside it,
  // the housing costs nothing — the total stays the same.
  const s1Row = [...doc.querySelectorAll("#l-jbs .lrow")].find(
    (r) => r.querySelector(".b").textContent === "S1",
  );
  assert.ok(s1Row, "row for S1");
  assert.match(
    s1Row.querySelector(".p").textContent,
    /179/,
    "price unchanged: housing 0 € + USW Flex 179 €",
  );
  assert.match(
    s1Row.querySelector(".t small").textContent,
    /USW Flex/,
    "the subtitle names the device at the point",
  );
  activate(/Kosten/);
  assert.equal(doc.getElementById("infra"), null, "the cost panel no longer has a checkbox list");
  // setText() writes plain text — markup in the text catalogue would show up literally
  const budget = doc.getElementById("f-budget");
  budget.value = "1";
  fire(budget, "change");
  assert.ok(!/[<>]/.test(doc.getElementById("c-left").textContent), "no markup in the budget text");
  assert.ok(
    doc.getElementById("c-left").classList.contains("over"),
    "a class highlights it when over budget",
  );
  budget.value = "999999";
  fire(budget, "change");
  assert.ok(
    !doc.getElementById("c-left").classList.contains("over"),
    "back to normal when under budget",
  );
  budget.value = "3000";
  fire(budget, "change");
  assert.ok(
    !/Innen, Wand oder Regal/.test(doc.getElementById("c-bom").textContent),
    "the 0 € housing appears in no bill of materials",
  );
  assert.match(
    doc.getElementById("c-bom").textContent,
    /USW Flex/,
    "the device inside it does though",
  );

  // Indoor/outdoor is both a spec and a search word — in both languages
  activate(/Bauen/);
  const camCards = () => [...doc.querySelectorAll("#cat-cams .item .d")].map((e) => e.textContent);
  const search = (s) => {
    const box = doc.getElementById("cat-q");
    box.value = s;
    fire(box, "input");
  };
  search("outdoor");
  assert.ok(camCards().length >= 10, 'searching "outdoor" finds the outdoor cameras');
  assert.ok(
    camCards().every((x) => x.endsWith(" · außen")),
    'only outdoor-capable cameras for "outdoor"',
  );
  search("innen");
  assert.ok(camCards().length >= 3, 'searching "innen" finds the indoor cameras');
  assert.ok(
    camCards().every((x) => x.endsWith(" · nur innen")),
    'only indoor cameras for "innen"',
  );
  search("ptz"); // state for the later reload check

  // Clicking the catalogue shows the preview in the selection panel — even if
  // something was previously selected on the map. Otherwise the preview stays hidden.
  activate(/Elemente/);
  doc
    .querySelector("#l-cams .lrow")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.ok(doc.querySelector("#pane-sel #f-model"), "an element is selected first");
  activate(/Bauen/);
  doc.querySelector("#cat-cams .item").click();
  const prev = doc.getElementById("pane-sel");
  assert.match(prev.textContent, /Vorschau/, "preview instead of the placeholder");
  assert.ok(
    !doc.querySelector("#pane-sel #f-model"),
    "clicking the catalogue clears an existing selection",
  );
  assert.match(prev.textContent, /Passt für/, "advice: when it fits");
  assert.match(prev.textContent, /Eher nicht/, "advice: when it doesn't");
  assert.ok(prev.querySelector(".product .plink[href]"), "product link in the preview");
  assert.match(
    prev.querySelector(".product img").getAttribute("src"),
    /^https:\/\/cdn\.ecomm\.ui\.com\//,
    "product image from the manufacturer catalogue",
  );
  doc.getElementById("t-select").click();

  // Junction point = housing + devices inside it. Clicking a device in the catalogue
  // drops it into the selected point; with nothing selected, it brings its own point along.
  activate(/Elemente/);
  doc
    .querySelectorAll("#l-jbs .lrow")[0]
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.ok(doc.getElementById("f-gears"), "the point has a section for its devices");
  assert.equal(
    doc.getElementById("f-gears").querySelectorAll(".cabrow").length,
    0,
    "the shaft starts empty",
  );
  activate(/Bauen/);
  doc.querySelector('#cat-tabs [data-tab="jb"]').click();
  assert.equal(
    doc.querySelectorAll("#cat-jbs .subhead").length,
    2,
    "the catalogue separates housings and devices",
  );
  assert.ok(
    doc.querySelector('#cat-jbs [data-key="indoor"]'),
    "„Indoor“ sits as a location in the catalogue",
  );

  // --- Catalogue card: ⓘ shows the data sheet without adding anything ------
  {
    const card = doc.querySelector('#cat-jbs [data-key="conv"]').closest(".itemrow");
    assert.ok(card, "every catalogue card sits in a row with an action column");
    const info = card.querySelector(".iteminfo");
    assert.ok(info, "and carries an ⓘ there");
    assert.equal(
      card.querySelectorAll("button").length,
      2,
      "the card and the ⓘ are siblings, not a button inside a button",
    );
    const gearsBefore = doc.getElementById("f-gears").querySelectorAll(".cabrow").length;
    info.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    assert.ok(doc.getElementById("infoDlg").open, "the ⓘ on the card opens the data sheet dialog");
    assert.match(
      doc.getElementById("infoHead").textContent,
      /Medienkonverter|converter/i,
      "and shows the model that was clicked",
    );
    assert.equal(
      doc.getElementById("f-gears").querySelectorAll(".cabrow").length,
      gearsBefore,
      "the ⓘ adds nothing to the point",
    );
    assert.equal(
      doc.getElementById("t-jb").getAttribute("aria-pressed"),
      "false",
      "and doesn't switch on a tool",
    );
    doc.getElementById("infoClose").click();
  }
  // The other tabs also carry the ⓘ — without triggering placement mode.
  doc.querySelector('#cat-tabs [data-tab="cond"]').click();
  {
    const card = doc.querySelector('#cat-cond [data-key="fiber"]').closest(".itemrow");
    card
      .querySelector(".iteminfo")
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    assert.match(
      doc.getElementById("infoHead").textContent,
      /Glasfaser|Fibre/,
      "the conduit template shows the cable inside it",
    );
    assert.equal(
      doc.getElementById("t-draw").getAttribute("aria-pressed"),
      "false",
      "and starts no drawing",
    );
    doc.getElementById("infoClose").click();
  }
  doc.querySelector('#cat-tabs [data-tab="jb"]').click();

  doc.querySelector('#cat-jbs [data-key="conv"]').click();
  assert.equal(
    doc.getElementById("t-jb").getAttribute("aria-pressed"),
    "false",
    "no placement mode — the device went into the point",
  );
  assert.equal(
    doc.getElementById("f-gears").querySelectorAll(".cabrow").length,
    1,
    "the device now sits in the point",
  );
  doc.querySelector('#cat-jbs [data-key="conv"]').click();
  assert.equal(doc.getElementById("f-gear-0").value, "2", "the same type again bumps the count");
  // Data sheet of the device, without leaving the point
  doc
    .getElementById("f-geari-0")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.match(
    doc.getElementById("infoBody").textContent,
    /SFP-Port vorhanden/,
    "the ⓘ shows the device's specs",
  );
  doc.getElementById("infoClose").click();
  doc
    .getElementById("f-gearx-0")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(
    doc.getElementById("f-gears").querySelectorAll(".cabrow").length,
    0,
    "the bin takes it back out",
  );
  // No preview box in the panel: the ⓘ next to the select shows the data sheet in a dialog.
  const gsel = doc.getElementById("f-gear-new");
  assert.equal(
    doc.getElementById("f-gear-prev"),
    null,
    "the add row no longer carries a preview box",
  );
  assert.ok(doc.getElementById("f-geari-new"), "instead an ⓘ button next to the select");

  // --- Selectors: groups instead of a flat list ------------------------
  {
    const groups = [...gsel.querySelectorAll("optgroup")].map((g) => g.getAttribute("label"));
    assert.deepEqual(
      groups,
      [
        "Switch mit PoE",
        "Switch/Konverter ohne PoE",
        "Speisung (Injektor, Extender)",
        "Zubehör (ohne Strom)",
      ],
      "the device select carries the four groups in a fixed order",
    );
    const opts = [...gsel.querySelectorAll("option")];
    assert.ok(
      opts.every((o) => o.parentElement.tagName === "OPTGROUP"),
      "every option sits in exactly one group",
    );
    const devices = [...html.matchAll(/^ {4}"([a-z0-9-]+)": +\{ kind: "device"/gm)].map(
      (m) => m[1],
    );
    assert.equal(
      opts.length,
      devices.length,
      `${devices.length} devices in the catalogue, ${opts.length} in the selector`,
    );
    // An injector also has a PoE budget — it still belongs under "power feed".
    const groupOf = (v) => opts.find((o) => o.value === v).parentElement.getAttribute("label");
    assert.match(
      groupOf("tplink-poe170s"),
      /Speisung/,
      "the injector sits with the power feeds, not the switches",
    );
    assert.match(groupOf("trendnet-tpe-e100"), /Speisung/, "the extender likewise");
    assert.match(
      groupOf("usw-ultra-60w"),
      /Switch mit PoE/,
      "a PoE switch sits with the PoE switches",
    );
    assert.match(
      groupOf("tplink-mc220l"),
      /ohne PoE/,
      "the media converter with the devices without PoE",
    );
    assert.match(
      groupOf("tplink-sm311ls"),
      /Zubehör/,
      "the SFP module with accessories without power",
    );
    // Key figure on the option: name · price · what it delivers.
    assert.match(
      opts.find((o) => o.value === "usw-ultra-60w").textContent,
      /129 € · 8× PoE · 52 W/,
      "the option names the price and the key figure",
    );
    // Housing select: buried, outdoors, indoors
    const hsel = doc.getElementById("f-model");
    assert.deepEqual(
      [...hsel.querySelectorAll("optgroup")].map((g) => g.getAttribute("label")),
      ["Erdverlegt", "Außen an der Wand", "Innen"],
      "the housing select separates by location",
    );
    assert.ok(
      [...hsel.querySelectorAll("option")].every((o) => o.parentElement.tagName === "OPTGROUP"),
      "there too, every housing sits in exactly one group",
    );
  }

  gsel.value = "lite8";
  doc
    .getElementById("f-geari-new")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.match(
    doc.getElementById("infoHead").textContent,
    /USW Lite 8/,
    "the dialog names the chosen device",
  );
  assert.ok(
    doc.querySelector("#infoBody .spec dd.ok, #infoBody .spec dd.warn"),
    "with rated specs",
  );
  assert.ok(doc.querySelector("#infoBody .product .plink[href]"), "and the product box");
  doc.getElementById("infoClose").click();
  gsel.value = "tplink-mc220l";
  doc
    .getElementById("f-geari-new")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.match(
    doc.getElementById("infoHead").textContent,
    /MC220L/,
    "changing the selection shows the other data sheet",
  );
  assert.ok(
    !/USW Lite 8/.test(doc.getElementById("infoHead").textContent),
    "and doesn't leave the old device standing",
  );
  doc.getElementById("infoClose").click();
  // The add row in the panel does the same thing as clicking the catalogue
  doc.getElementById("f-gear-new").value = "lite8";
  doc
    .getElementById("f-gear-go")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(
    doc.getElementById("f-gears").querySelectorAll(".cabrow").length,
    1,
    "adding drops a device into the point",
  );
  // --- Hover card: one node, no state -----------------------------
  const row = doc.getElementById("f-gears").querySelector(".cabrow[data-hover]");
  assert.ok(row, "the device row carries its catalogue key for the hover card");
  const card = doc.getElementById("hovercard");
  assert.ok(card, "the hover card sits as a single node in the document");
  assert.ok(card.hidden, "and is hidden at first");
  row.dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: false }));
  assert.ok(card.hidden, "it doesn't appear right away, only after a pause");
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(card.hidden, false, "after the pause it's there");
  assert.match(card.textContent, /USW Lite 8/, "and names the device");
  assert.match(card.textContent, /8× PoE/, "along with the key figure");
  assert.equal(doc.querySelectorAll("#hovercard").length, 1, "it stays a single node");
  row.dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: false }));
  assert.ok(card.hidden, "it disappears again on leaving");
  // No state: none of it lands in the plan.
  assert.ok(
    !/hover/i.test(
      JSON.stringify(
        JSON.parse(
          dom.window.localStorage.getItem(
            "sl-plan:" + dom.window.localStorage.getItem("sl-current"),
          ) || "{}",
        ),
      ),
    ),
    "the hover card leaves nothing in the saved plan",
  );
  doc
    .getElementById("f-gearx-0")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  doc.querySelector('#cat-jbs [data-key="conv"]').click();
  assert.equal(
    doc.getElementById("t-jb").getAttribute("aria-pressed"),
    "true",
    "with nothing selected, the device gets placed",
  );
  // A location for 0 € has nothing to buy: product link yes, dealer search no
  doc.querySelector('#cat-jbs [data-key="indoor"]').click();
  assert.ok(doc.querySelector("#pane-sel .product"), "preview shows the location");
  assert.equal(
    doc.querySelector("#pane-sel .shopsel"),
    null,
    "no dealer search for an item with no price",
  );
  doc.querySelector('#cat-jbs [data-key="shaft"]').click();
  assert.ok(doc.querySelector("#pane-sel .shopsel"), "a housing with a price has one");
  assert.match(
    doc.querySelector("#pane-sel .product .plink").getAttribute("href"),
    /kabelschacht24/,
    "product link on the shaft",
  );
  doc.getElementById("t-select").click();
  doc.querySelector('#cat-tabs [data-tab="cam"]').click();

  // In-app help
  doc.getElementById("t-help").click();
  const helpTxt = doc.getElementById("helpBody").textContent;
  assert.match(helpTxt, /Glasfaser geht nie direkt/, "help names the fibre rule");
  assert.ok(doc.querySelectorAll("#helpBody kbd").length >= 8, "help lists tools and keys");
  assert.equal(
    doc.getElementById("helpDocs").getAttribute("href"),
    "/help",
    "help links to the guide",
  );
  assert.equal(
    doc.getElementById("t-home").getAttribute("href"),
    "/",
    "back to the home page from the planner",
  );
  doc.getElementById("helpClose").click();

  // The place search sits on the map and starts no panning
  const geo = doc.getElementById("geoQ");
  assert.ok(geo, "search field on the map");
  geo.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true }));
  assert.ok(
    !doc.getElementById("mapwrap").classList.contains("panning"),
    "the search field starts no panning",
  );

  // Naming the plan
  const nameBox = doc.getElementById("projName");
  nameBox.value = "Testhof";
  fire(nameBox, "input");
  assert.match(doc.title, /^Testhof/, "the title follows the name");
  const subBox = doc.getElementById("projSub");
  subBox.value = "Flurstück 7, Flur 3 · Musterdorf";
  fire(subBox, "input");
  assert.ok(subBox, "the subtitle is editable");

  // Sharing: the whole plan sits in the link
  doc.getElementById("t-share").click();
  await new Promise((r) => setTimeout(r, 120));
  const hash = dom.window.location.hash;
  assert.match(hash, /^#p=[12]/, "the link carries the plan");
  const kind = hash[3];
  const payload = hash.slice(4); // '#p=' plus the marker
  const bytes = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const shared = JSON.parse(
    kind === "2" ? (await import("node:zlib")).inflateRawSync(bytes).toString() : bytes.toString(),
  );
  assert.equal(shared.name, "Testhof", "the name sits in the link");
  assert.ok(Array.isArray(shared.items) && shared.items.length >= 6, "elements sit in the link");
  assert.ok(
    Array.isArray(shared.conduits) && shared.conduits.length >= 3,
    "conduits sit in the link",
  );

  // Several plans: a new one is empty and doesn't displace the old one
  activate(/Elemente/);
  const nPlans = JSON.parse(dom.window.localStorage.getItem("sl-plans") || "[]").length;
  doc.getElementById("l-new").click();
  await new Promise((r) => setTimeout(r, 50));
  const plansNow = JSON.parse(dom.window.localStorage.getItem("sl-plans") || "[]");
  assert.equal(plansNow.length, nPlans + 1, "a new plan gets added, the old one stays");
  assert.equal(doc.querySelectorAll(".marker.cam").length, 0, "a new plan starts empty");
  // The new plan must inherit neither the name nor the content of the old one.
  const freshId = dom.window.localStorage.getItem("sl-current");
  const fresh = JSON.parse(dom.window.localStorage.getItem("sl-plan:" + freshId));
  assert.equal(fresh.items.length, 0, "the new plan contains none of the old plan's elements");
  assert.equal(fresh.conduits.length, 0, "the new plan contains none of the old plan's conduits");
  assert.equal((fresh.name || "").trim(), "", "the new plan is unnamed");
  assert.equal(plansNow.find((e) => e.id === freshId).n, 0, "the list counts the new plan as 0");
  assert.ok(
    plansNow.some((e) => e.id !== freshId && (e.name || "").trim()),
    "the named plan sits untouched next to it",
  );
  // back to the test plan
  const menu2 = doc.getElementById("projMenu");
  menu2.open = true;
  menu2.dispatchEvent(new dom.window.Event("toggle"));
  const rows = [...doc.querySelectorAll("#projList .projrow .pick")];
  assert.ok(rows.length >= 2, "the plan menu lists both plans");
  const older = rows.find((b) => !/Unbenannt/.test(b.textContent));
  assert.ok(older, "the named plan is in the list");
  older.click();
  assert.ok(doc.querySelectorAll(".marker.cam").length >= 2, "switching brings back the plan");

  // Everything essential lives in localStorage — a reload looks exactly the same
  // Every plan sits under its own key; the old single-plan state has been migrated.
  const ls = dom.window.localStorage;
  // migrateKeys(): the oh- prefix is gone, a free sl- name inherits the value, an
  // occupied one keeps its own. The plan seeded as oh-plan arrived as a real plan above.
  assert.equal(ls.getItem("oh-plan"), null, "the oh- prefix is gone");
  assert.equal(ls.getItem("oh-spare"), null, "every oh- key is removed, not just the known ones");
  assert.equal(ls.getItem("sl-spare"), "carried over", "an unknown oh- key is carried over too");
  assert.equal(ls.getItem("sl-taken"), "new", "an existing sl- key is not overwritten");
  assert.equal(ls.getItem("oh-taken"), null, "and the old one is dropped anyway");
  assert.equal(ls.getItem("sl-plan"), null, "the old single key is resolved away");
  const index = JSON.parse(ls.getItem("sl-plans") || "[]");
  assert.ok(index.length >= 1, "plan list created");
  assert.ok(index[0].updated > 0 && "n" in index[0], "the list carries a change time and a count");
  const current = ls.getItem("sl-current");
  assert.ok(current && index.some((e) => e.id === current), "the current plan is in the list");
  const saved = JSON.parse(ls.getItem("sl-plan:" + current));
  for (const k of [
    "lang",
    "name",
    "sub",
    "shop",
    "basemap",
    "overlay",
    "view",
    "dock",
    "dockSize",
    "catQuery",
    "catFacets",
    "look",
  ]) {
    assert.ok(k in saved, `${k} gets saved`);
  }
  assert.equal(saved.catQuery.cam, "ptz", "search text per tab survives a reload");
  assert.ok(
    saved.items.every((i) => Number.isFinite(i.e) && Number.isFinite(i.n)),
    "every element carries geo-coordinates (e/n)",
  );
  assert.ok(
    saved.conduits.every((c) =>
      c.points.every((q) => Number.isFinite(q.e) && Number.isFinite(q.n)),
    ),
    "every conduit point carries geo-coordinates",
  );
  assert.ok(saved.geo && Number.isFinite(saved.geo.e0), "the plan knows its tile anchor");
  assert.equal(saved.catTab, "cam", "the active tab gets saved");
  // The five toggles behind the eye sit fully in the default state — otherwise
  // one would be missing in the saved plan and only reappear via `sh[k] !== false`.
  assert.deepEqual(
    Object.keys(saved.show).sort(),
    ["conds", "cones", "labels", "rings", "sections"],
    "defaultState().show carries every SHOW_KEY",
  );
  assert.deepEqual(
    Object.keys(saved.catQuery).sort(),
    ["ap", "cam", "cond", "gear", "jb"],
    "search text per catalogue tab, including the head end",
  );
  assert.equal(saved.look.font, 1.2, "the appearance sliders travel with the plan");
  assert.equal(saved.look.size, 1, "the reset made it into the plan");
  // Migration: a jb that used to be the device itself becomes a location + a device inside it
  const s1Saved = saved.items.find((i) => i.id === "s1");
  assert.equal(s1Saved.model, "indoor", 'the switch point becomes the "indoor" location');
  assert.deepEqual(s1Saved.gear, [{ model: "flex", n: 1 }], "the old model moves into gear");
  assert.ok(
    saved.items.filter((i) => i.kind === "jb").every((i) => Array.isArray(i.gear)),
    "every point carries a device list",
  );
  assert.equal(saved.items.find((i) => i.id === "j1").model, "shaft", "a housing stays a housing");
  assert.ok(saved.view && saved.view.w > 0, "viewport saved");
  // A click on a tool button bubbles up to the map — it must place nothing there.
  const nJb = doc.querySelectorAll(".marker.jb").length;
  doc.getElementById("t-jb").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(
    doc.querySelectorAll(".marker.jb").length,
    nJb,
    "the tool button places no junction under the palette",
  );
  doc.getElementById("t-jb").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

  // --- Drawing: conduit (L, defaults to fibre) and cable (C, Cat6A) ------------
  // Must run last — the conduits created here stay in the plan.
  {
    const key = (k) =>
      doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true }));
    const mapClick = (x, y) =>
      doc
        .getElementById("mapwrap")
        .dispatchEvent(
          new dom.window.MouseEvent("click", { bubbles: true, clientX: x, clientY: y }),
        );
    const lastCond = () => [...doc.querySelectorAll("#g-conduits g.conduit")].pop();
    const strandColors = (g) =>
      [...g.querySelectorAll("path.strand")].map((p) => p.getAttribute("stroke"));
    const nBefore = doc.querySelectorAll("#g-conduits g.conduit").length;

    // Fibre to a junction stays fibre — it sits in an SFP cage there.
    key("l");
    assert.equal(
      doc.getElementById("t-draw").getAttribute("aria-pressed"),
      "true",
      "L switches to conduit",
    );
    mapClick(100, 100);
    mapClick(200, 200);
    key("Enter");
    assert.equal(
      doc.querySelectorAll("#g-conduits g.conduit").length,
      nBefore + 1,
      "the draft becomes a conduit",
    );
    assert.deepEqual(strandColors(lastCond()), ["var(--accent)"], "to a junction it stays fibre");

    // The same draft at a camera: there's no SFP port there, so it becomes Cat6A.
    key("l");
    mapClick(100, 100);
    mapClick(170, 70);
    key("Enter");
    assert.deepEqual(strandColors(lastCond()), ["var(--ink-3)"], "at the camera it becomes Cat6A");
    assert.match(
      doc.getElementById("toast").textContent,
      /Cat6A statt Glasfaser.*K1/,
      "and the notice names the device",
    );

    // The dedicated tool lays copper from the start.
    key("c");
    assert.equal(
      doc.getElementById("t-cable").getAttribute("aria-pressed"),
      "true",
      "C switches to cable",
    );
    assert.equal(
      doc.getElementById("t-draw").getAttribute("aria-pressed"),
      "false",
      "and not to conduit",
    );
    assert.equal(
      doc.querySelector('#cat-cond [data-key="cable"]').getAttribute("aria-pressed"),
      "true",
      'the catalogue\'s "cable without pipe" template shows pressed',
    );
    mapClick(100, 100);
    mapClick(200, 200);
    key("Enter");
    const cbl = lastCond();
    assert.deepEqual(
      strandColors(cbl),
      ["var(--ink-3)"],
      "drawing a cable lays Cat6A, even at a junction",
    );
    assert.equal(cbl.querySelector("path.trench"), null, "and with no trench");
    assert.equal(cbl.querySelectorAll("path.duct").length, 0, "and no pipe");
    // The fresh conduit is selected: pipe costs and earthwork must drop out.
    const dd = [...doc.querySelectorAll("#f-cstats dd")].map((n) => n.textContent.trim());
    assert.equal(doc.getElementById("f-kind").value, "cable", "C draws a cable run");
    assert.equal(dd[1], "–", "a drawn cable costs no pipe");
    assert.equal(dd[4], "–", "and no earthwork");
    const eur = (x) => +x.split("(")[0].replace(/[^\d]/g, ""); // the parenthesis carries numbers in the cable name
    assert.ok(
      Math.abs(eur(dd[5]) - (eur(dd[2]) + eur(dd[3]))) <= 1,
      "the total is cable plus fixed costs, nothing else",
    );
    key("Escape");
  }
  assert.equal(
    errors.length,
    0,
    `runtime error after interacting: ${errors.map((e) => e.message).join(" | ")}`,
  );
  dom.window.close();
}
console.log("ok — page boots in jsdom: panels, language, product links, base map, localStorage");

// --- Connections and head end ---------------------------------------------
// A dedicated boot with a plan whose topology adds up cleanly: fibre from the house
// to the switch, copper from the switch to the camera — and a camera hanging off nothing.
{
  const jsdom = await import("jsdom");
  const { JSDOM } = jsdom;
  const errors = [];
  const PX = 5.957; // PX_PER_M, see public/planner/index.html
  const FIXTURE = {
    name: "Anschlussplan",
    sub: "",
    lang: "de",
    budget: 3000,
    earthwork: 0,
    seq: 9,
    geo: { e0: 356448.6, n0: 5645366.7 },
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
      // Switch without SFP at the fibre end, and a camera that needs no cable at all
      { id: "s3", kind: "jb", model: "lite8", label: "S3", x: 200, y: 600, note: "" },
      { id: "k3", kind: "cam", model: "g6-instant", label: "K3", x: 500, y: 800, rot: 0, note: "" },
      // Two switches hanging only off each other — unreachable from the head end
      { id: "s4", kind: "jb", model: "usw-ultra-60w", label: "S4", x: 1000, y: 200, note: "" },
      { id: "s5", kind: "jb", model: "usw-ultra-60w", label: "S5", x: 1100, y: 300, note: "" },
      // Switch on copper off S1 — it occupies a port there and draws no power
      {
        id: "s7",
        kind: "jb",
        model: "usw-ultra-60w",
        label: "S7",
        x: 300 + 20 * PX,
        y: 400,
        note: "",
      },
      // Media converter: one port, uplink over fibre, a camera on it
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
      // Fibre into a passive shaft, copper behind it: that's not an uplink
      { id: "j9", kind: "jb", model: "shaft", label: "J9", x: 700, y: 900, note: "" },
      { id: "s8", kind: "jb", model: "flex", label: "S8", x: 900, y: 900, note: "" },
      // A distribution box with two devices: the converter turns the fibre into copper,
      // the switch distributes it further — its port counts, the converter's doesn't.
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
      // The same box, but empty: the fibre passes through (no error), the copper
      // behind it still has no source.
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
      // Camera directly at the head end: checks the router's PoE output and ports
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
      // Camera on the island: connected, but its source itself hangs off nothing
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
      // Shaft with a splice box: a fibre may really be split here
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
      // Fibre straight into a camera: its own finding, not that of the converter before it
      {
        id: "kf",
        kind: "cam",
        model: "g6-bullet",
        label: "KF",
        x: 1200,
        y: 1000,
        rot: 0,
        note: "",
      },
      // Two SFP cages, two arriving fibres: that adds up. S1 next to it has only
      // one cage and also two fibres — the count is what matters, not the port number.
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
    // Working zoom, so the markers stand on their own and don't collapse into groups.
    view: { x: 0, y: 0, w: 1700, h: 1700 },
    // The head end needs a router: without one it accepts neither fibre nor copper.
    infra: { ucg: { on: true, qty: 1 } },
  };
  const dom = new JSDOM(html, {
    url: `${base}/planner`,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    resources: "usable",
    virtualConsole: new jsdom.VirtualConsole().on("jsdomError", (e) => errors.push(e)),
    beforeParse(win) {
      try {
        win.localStorage.clear();
        win.localStorage.setItem("sl-plan", JSON.stringify(FIXTURE));
      } catch {}
    },
  });
  if (!dom.window.ResizeObserver) {
    dom.window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  const proto = dom.window.SVGSVGElement.prototype;
  proto.createSVGPoint = function () {
    return { x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) };
  };
  proto.getScreenCTM = function () {
    return { inverse: () => ({}) };
  };
  await new Promise((r) => dom.window.addEventListener("load", r));
  await new Promise((r) => setTimeout(r, 400));

  const doc = dom.window.document;
  assert.equal(
    errors.length,
    0,
    `runtime error while booting: ${errors.map((e) => e.message).join(" | ")}`,
  );
  const menu = doc.getElementById("viewMenu");
  const activate = (re) => {
    menu.open = true;
    menu.dispatchEvent(new dom.window.Event("toggle"));
    const entry = [...doc.querySelectorAll("#viewList button")].find((b) => re.test(b.textContent));
    assert.ok(entry, `menu entry for ${re}`);
    entry.click();
  };
  const pickRow = (sel, i) =>
    doc
      .querySelectorAll(sel)
      [i].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  const linkTxt = () => doc.getElementById("f-link").textContent;

  // Camera at a switch: source and distance sit in the selection panel
  activate(/Elemente/);
  pickRow("#l-cams .lrow", 0);
  assert.match(linkTxt(), /Versorgt über S1/, "K1 hangs off switch S1");
  assert.match(linkTxt(), /40 m Cat6A/, "the distance comes from the route");
  assert.match(linkTxt(), /Kupfer/, 'the conduit shows in the "conduits here" row');

  // Camera without a cable: red ring on the map, finding in the panel
  activate(/Elemente/);
  pickRow("#l-cams .lrow", 1);
  assert.match(linkTxt(), /Kein Kabel bis hierher/, "K2 has no connection");
  assert.ok(doc.querySelector('#g-markers .marker[data-id="k2"] circle.alert'), "K2 gets a ring");
  assert.ok(!doc.querySelector('#g-markers .marker[data-id="k1"] circle.alert'), "K1 gets none");
  assert.ok(
    doc.querySelector("#l-cams .lrow:nth-child(2) .st.err"),
    "the element list shows the dot",
  );

  // Switch: uplink over the fibre, PoE budget and the devices on it
  activate(/Elemente/);
  pickRow("#l-jbs .lrow", 0);
  assert.match(linkTxt(), /Uplink über H1/, "S1 hangs off the house over fibre");
  assert.match(linkTxt(), /Glasfaser/, "namely over fibre");
  assert.match(
    linkTxt(),
    /15,4 von 196 W/,
    "PoE load: one 802.3af camera, the switch on it draws nothing",
  );
  assert.match(
    linkTxt(),
    /2 von 8 belegt/,
    "ports: camera and switch, the fibre uplink occupies none",
  );
  assert.match(linkTxt(), /K1/, "K1 shows as a device on the switch");
  assert.match(linkTxt(), /S7/, "the switch attached over copper occupies a port here");
  // The device shows as its own row in the point, its values aggregated in the connection box
  assert.match(
    doc.getElementById("pane-sel").textContent,
    /USW Flex/,
    "the device sits in the point",
  );
  assert.equal(
    doc.getElementById("f-gears").querySelectorAll(".cabrow").length,
    1,
    "exactly one device in S1",
  );
  assert.match(linkTxt(), /196 W/, "the PoE budget comes from the device");

  // Fibre at a switch without an SFP port is an error, not a connection
  activate(/Elemente/);
  pickRow("#l-jbs .lrow", 1);
  assert.match(linkTxt(), /kein SFP-Port/, "S3 doesn't accept the fibre");
  assert.ok(doc.querySelector('#g-markers .marker[data-id="s3"] circle.alert'), "S3 gets a ring");

  // A Wi-Fi camera draws no power from the network cable — no finding, no ring
  activate(/Elemente/);
  pickRow("#l-cams .lrow", 2);
  assert.ok(!/Kein Kabel bis hierher/.test(linkTxt()), "K3 needs no connection");
  assert.ok(
    !doc.querySelector('#g-markers .marker[data-id="k3"] circle.alert'),
    "and gets no ring",
  );

  // Two switches hanging only off each other are nowhere near on the network
  for (const [i, id] of [
    [2, "s4"],
    [3, "s5"],
  ]) {
    activate(/Elemente/);
    pickRow("#l-jbs .lrow", i);
    assert.match(linkTxt(), /Kein Uplink/, `${id} doesn't reach the head end`);
    assert.ok(
      doc.querySelector(`#g-markers .marker[data-id="${id}"] circle.alert.warn`),
      `${id} gets a yellow ring`,
    );
  }

  // Fibre into a passive shaft and copper continuing behind it is not an
  // uplink — the switch-over only happens at a device with an SFP port.
  const jbRow = (label) => {
    activate(/Elemente/);
    const r = [...doc.querySelectorAll("#l-jbs .lrow")].find(
      (x) => x.querySelector(".b").textContent === label,
    );
    assert.ok(r, `row for ${label}`);
    r.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  };
  jbRow("S8");
  assert.match(linkTxt(), /Kein Uplink/, "the shaft doesn't switch the fibre over to copper");

  // Device rows carry the unit price; from two units on, the unit price sits in front.
  jbRow("J5");
  {
    const prices = [...doc.querySelectorAll("#f-gears .cabrow .p")].map((n) => n.textContent);
    assert.deepEqual(prices, ["15 €", "129 €"], "the unit price per device on its row");
    const qty = doc.getElementById("f-gear-1");
    qty.value = "2";
    qty.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    jbRow("J5");
    assert.equal(
      doc.getElementById("f-gearp-1").textContent,
      "2 × 129 €",
      "with several units: quantity × unit price",
    );
    doc.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
    );
  }
  // Converter + switch without SFP at the fibre end: a switch with an SFP cage does both.
  // It recommends the cheapest one that covers the PoE need and the ports — changes nothing.
  jbRow("J5");
  {
    const adv = doc.getElementById("f-jb-advice");
    assert.ok(adv && !adv.hidden, "a recommendation sits at the fibre end");
    assert.match(
      adv.textContent,
      /TL-SG2210MP \(Switch\) \(150 €\)/,
      "it names the cheapest switch with SFP and PoE",
    );
    assert.match(adv.textContent, /150 W PoE/, "and how much PoE it delivers");
    assert.match(adv.textContent, /144 €/, "plus the sum of what it replaces");
  }
  // A point that already accepts the fibre itself gets no sentence.
  jbRow("S8");
  assert.ok(
    doc.getElementById("f-jb-advice").hidden,
    "a point with SFP and PoE needs no recommendation",
  );

  // A media converter has exactly one port — the uplink over fibre needs none
  jbRow("C1");
  assert.match(linkTxt(), /Uplink über H1/, "C1 hangs off the head end over fibre");
  assert.match(linkTxt(), /1 von 1 belegt/, "the camera occupies the one port, the fibre doesn't");

  // The switch on copper knows its source and occupies a port there, just as at itself
  jbRow("S7");
  assert.match(linkTxt(), /Uplink über H1/, "S7 reaches the head end via S1");
  assert.match(linkTxt(), /1 von 8 belegt/, "its copper uplink occupies one port on it");

  // A point with two devices: budget and ports get summed across the devices
  jbRow("J5");
  assert.match(linkTxt(), /Uplink über H1/, "J5 hangs off the head end over fibre");
  assert.match(linkTxt(), /15,4 von 52 W/, "the PoE budget is the sum of the devices");
  assert.match(
    linkTxt(),
    /1 von 8 belegt/,
    "ports: the switch counts, the converter feeds in internally",
  );
  assert.match(
    doc.getElementById("pane-sel").textContent,
    /USW Ultra/,
    "both devices sit in the point",
  );
  assert.equal(
    doc.getElementById("f-gears").querySelectorAll(".cabrow").length,
    2,
    "two devices in the box",
  );
  assert.ok(
    doc.querySelector('#g-markers .marker[data-id="j5"].active'),
    "a point with gear is filled in",
  );

  // A box without devices is not an error, but the fibre ends there with no counterpart:
  // that's a warning (yellow), not an error. The copper behind it has no source —
  // and now the camera says exactly that, instead of "no cable reaches here".
  assert.ok(
    !doc.querySelector('#g-markers .marker[data-id="j6"] circle.alert.err'),
    "the empty box is not an error",
  );
  assert.ok(
    doc.querySelector('#g-markers .marker[data-id="j6"] circle.alert.warn'),
    "but the fibre ends there with no counterpart",
  );
  assert.ok(
    !doc.querySelector('#g-markers .marker[data-id="j6"].active'),
    "and stays an empty diamond",
  );
  jbRow("J6");
  assert.match(
    linkTxt(),
    /1 × Glasfaser SM, 4 Fasern enden an J6 ohne Gegenstück/,
    "the balance names the count and the cable type",
  );
  activate(/Elemente/);
  const k6row = [...doc.querySelectorAll("#l-cams .lrow")].find(
    (r) => r.querySelector(".b").textContent === "K6",
  );
  assert.ok(k6row, "row for K6");
  assert.match(
    k6row.querySelector(".t small").textContent,
    /Kabel endet an J6/,
    "K6 is cabled, but J6 delivers nothing",
  );
  assert.ok(
    !/Kein Kabel bis hierher/.test(k6row.querySelector(".t small").textContent),
    "and no longer gets the wrong sentence",
  );

  // The element list names the source instead of a dash
  activate(/Elemente/);
  const camSubs = [...doc.querySelectorAll("#l-cams .lrow .t small")].map((e) => e.textContent);
  assert.match(camSubs[0], /^über S1 · 40 m Cat6A$/, "K1 with no note shows the feed");
  assert.match(camSubs[1], /Kein Kabel bis hierher/, "K2 shows the problem");
  assert.ok(
    camSubs.some((x) => /liefert kein PoE/.test(x)),
    "K9 at the media converter gets no power",
  );

  // The cost panel collects the findings
  activate(/Kosten/);
  assert.match(
    doc.getElementById("c-warn").textContent,
    /ohne sauberen Anschluss/,
    "warning in the cost panel",
  );

  // Export: the finding travels along — Markdown for an AI and the print sheet
  doc.getElementById("t-export").click();
  doc.getElementById("exp-md").click();
  await new Promise((r) => setTimeout(r, 30));
  const md = doc.querySelector("#exp-out textarea").value;
  assert.match(md, /## Anschlüsse/, 'the Markdown has a "Connections" section');
  assert.match(md, /Versorgt über S1/, "and names the source per device");
  assert.match(md, /\*\*S1\*\*: K1, S7 · 15,4 \/ 196 W/, "and the load per switch");
  assert.match(md, /K2: Kein Kabel bis hierher/, '"please check" picks up the findings');
  // Conduit lengths are already in metres — don't divide by the scale a second time
  assert.match(
    md,
    /\| Kupfer \| S1 \| K1 \| 40 m \|/,
    "the conduit table doesn't compute the length twice",
  );
  // Product links travel along: the manufacturer page and, where checked, the Amazon article.
  assert.match(md, /## Produktlinks/, "the Markdown lists the product links");
  assert.match(
    md,
    /· Amazon: https:\/\/www\.amazon\.de\/dp\/[A-Z0-9]{10}/,
    "and the Amazon article alongside each product",
  );
  // window.print() is unknown to jsdom; the sheet itself can still be checked.
  dom.window.print = () => {};
  doc.getElementById("t-export").click();
  doc.getElementById("exp-p-links").checked = true; // product links belong on the sheet too
  doc.getElementById("exp-pdf").click();
  const sheet = doc.getElementById("printsheet");
  assert.ok(sheet, "print sheet built");
  assert.match(
    sheet.querySelector("ul.links").textContent,
    /Amazon: https:\/\/www\.amazon\.de\/dp\//,
    "the print sheet carries both addresses per product",
  );
  assert.match(sheet.textContent, /via S1 · 40 m/, "the element row names the connection");
  assert.match(sheet.textContent, /⚠ Kein Kabel bis hierher/, "and the problem where there is one");
  sheet.remove();

  // --- Head end: router, devices, checking -----------------------------------
  const fire2 = (elm, type) => elm.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  const click = (elm) => elm.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  const pickHub = () => {
    doc
      .querySelector('#g-markers .marker[data-id="h1"]')
      .dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true }));
    dom.window.dispatchEvent(new dom.window.MouseEvent("pointerup", { bubbles: true }));
  };
  const camRow = (label) => {
    activate(/Elemente/);
    const r = [...doc.querySelectorAll("#l-cams .lrow")].find(
      (x) => x.querySelector(".b").textContent === label,
    );
    assert.ok(r, `row for ${label}`);
    r.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  };
  pickHub();
  assert.ok(doc.getElementById("f-router"), "the head end picks its router in the selection panel");
  assert.equal(doc.getElementById("f-router").value, "ucg", "the planned router shows there");
  assert.equal(
    doc.querySelector("#pane-sel .product"),
    null,
    "the panel no longer carries a data sheet",
  );
  click(doc.getElementById("f-routeri"));
  assert.match(
    doc.getElementById("infoHead").textContent,
    /Cloud Gateway/,
    "the ⓘ next to the select opens the router's data sheet",
  );
  assert.match(
    doc.getElementById("infoBody").textContent,
    /SFP-Port vorhanden/,
    "with ports, SFP and PoE",
  );
  assert.ok(doc.querySelector("#infoBody .product .plink[href]"), "and the product box");
  doc.getElementById("infoClose").click();
  // An old plan has no hub.gear — the migration creates an empty list
  assert.equal(
    doc.getElementById("f-gears").querySelectorAll(".cabrow").length,
    0,
    "an old house connection starts without devices",
  );
  assert.match(linkTxt(), /UniFi Cloud Gateway Fiber/, "the finding names the router");
  assert.match(
    linkTxt(),
    /15,4 von 30 W/,
    "PoE load: the UCG hands out 30 W, the camera draws 15.4",
  );
  assert.match(linkTxt(), /1 von 4 belegt/, "the head end's ports are the router's LAN jacks");
  // Five fibre cables onto one LAN-side SFP cage — that doesn't add up
  assert.match(
    linkTxt(),
    /5 Faserkabel auf 1 SFP/,
    "the fibre count gets checked against the SFP cages",
  );
  assert.ok(
    doc.querySelector('#g-markers .marker[data-id="h1"] circle.alert.warn'),
    "and colours the ring yellow",
  );
  camRow("KH");
  assert.match(linkTxt(), /Versorgt über H1/, "KH hangs off the head end over copper");

  // Recommendation and buying guide: what's still missing and what belongs there at all
  pickHub();
  const adv = () => doc.getElementById("f-hub-advice").textContent;
  assert.match(adv(), /SFP\+-Port des Routers/, "the fibre goes straight into the router");
  click(doc.querySelector("#pane-sel .selhead #f-info"));
  assert.match(
    doc.getElementById("infoBody").textContent,
    /Medienkonverter/,
    "the header's ⓘ explains what belongs in the head end",
  );
  doc.getElementById("infoClose").click();

  // FRITZ!Box: no LAN SFP, no PoE — the planner must say both
  pickHub();
  const rsel = doc.getElementById("f-router");
  rsel.value = "fb7690";
  fire2(rsel, "change");
  assert.match(linkTxt(), /kein SFP-Port/, "the FRITZ!Box doesn't accept the arriving fibre");
  assert.match(
    adv(),
    /kein SFP-Port/,
    "the recommendation names a switch with SFP or a media converter",
  );
  assert.ok(
    doc.querySelector('#g-markers .marker[data-id="h1"] circle.alert.err'),
    "red ring on the head end",
  );
  camRow("KH");
  assert.match(linkTxt(), /liefert kein PoE/, "without a PoE output the head end feeds no camera");

  // A media converter accepts the fibre but delivers no PoE
  pickHub();
  // The panel gets rebuilt on every device change — so fetch the select fresh.
  const addGearTo = (key) => {
    const sel2 = doc.getElementById("f-gear-new");
    sel2.value = key;
    fire2(sel2, "change");
    click(doc.getElementById("f-gear-go"));
  };
  addGearTo("tplink-mc220l");
  assert.match(adv(), /PoE-Switch/, "the recommendation now calls for a PoE switch");
  click(doc.getElementById("f-gearx-0"));

  // A PoE switch as a device in the head end restores power
  addGearTo("usw-ultra-60w");
  assert.equal(
    doc.getElementById("f-gears").querySelectorAll(".cabrow").length,
    1,
    "the switch sits in the head end",
  );
  assert.match(linkTxt(), /15,4 von 52 W/, "the PoE budget now comes from the switch");
  camRow("KH");
  assert.match(linkTxt(), /Versorgt über H1/, "and the camera is supplied");
  assert.ok(!/liefert kein PoE/.test(linkTxt()), "no more PoE notice");
  activate(/Kosten/);
  assert.match(
    doc.getElementById("c-bom").textContent,
    /USW Ultra 60W/,
    "the head end's device shows up in the bill of materials",
  );

  // "none": the head end is then just a cable point
  pickHub();
  click(doc.getElementById("f-gearx-0"));
  const rsel2 = doc.getElementById("f-router");
  rsel2.value = "";
  fire2(rsel2, "change");
  assert.match(linkTxt(), /Kein Router in der Zentrale/, "without a router, the head end says so");
  camRow("KH");
  assert.match(linkTxt(), /Kabel endet an H1/, "and the camera on it hangs off nothing");
  pickHub();
  const rsel3 = doc.getElementById("f-router");
  assert.match(adv(), /Noch kein Router/, "and the recommendation starts with the router");
  rsel3.value = "ucg";
  fire2(rsel3, "change");
  assert.match(linkTxt(), /UniFi Cloud Gateway Fiber/, "router back, finding back on the device");
  // Router plus a device that accepts the fibre: nothing missing anymore
  addGearTo("tplink-mc220l");
  assert.match(
    adv(),
    /^Passt: UniFi Cloud Gateway Fiber \+ TP-Link MC220L/,
    "then the recommendation says what's in place",
  );
  click(doc.getElementById("f-gearx-0"));

  // --- Connected is not supplied ---------------------------------------
  camRow("K4");
  assert.match(linkTxt(), /Versorgt über S4, aber S4 hat keinen Uplink/, "K4 hangs off an island");
  assert.ok(
    doc.querySelector('#g-markers .marker[data-id="k4"] circle.alert.err'),
    "red ring at the camera",
  );
  assert.ok(
    doc.querySelector('#g-markers .marker[data-id="s4"] circle.alert.warn'),
    "yellow ring at the point — each reports its own part",
  );

  // --- Cable balance: a warning without a splice box, none with one ----------
  jbRow("J7");
  assert.ok(
    !/ohne Gegenstück/.test(linkTxt()),
    "with a splice box the fibre may really be split here",
  );
  assert.ok(
    !doc.querySelector('#g-markers .marker[data-id="j7"] circle.alert'),
    "so no ring on the shaft",
  );

  // --- SFP cages only count what really goes in here ---------------
  jbRow("C1");
  assert.ok(
    !/Faserkabel auf/.test(linkTxt()),
    "the fibre to the camera occupies no SFP cage on the converter",
  );
  // The count comes from `sfpPorts` on the device: two cages carry two fibres …
  jbRow("S9");
  assert.ok(!/Faserkabel auf/.test(linkTxt()), "two fibres on two SFP cages is no finding");
  // … and a switch with one cage reports the second fibre.
  jbRow("S1");
  assert.match(linkTxt(), /2 Faserkabel auf 1 SFP/, "the USW Flex has one SFP cage, not two");
  camRow("KF");
  assert.match(linkTxt(), /Glasfaser endet am Gerät/, "it's that camera's own finding");
  assert.ok(
    doc.querySelector('#g-markers .marker[data-id="kf"] circle.alert.err'),
    "with a red ring there",
  );

  // --- Conduit name: a template follows along, a typed name stays --------
  const condRow = (label) => {
    activate(/Elemente/);
    const r = [...doc.querySelectorAll("#l-conds .lrow")].find((x) =>
      x.querySelector(".t").textContent.startsWith(label),
    );
    assert.ok(r, `conduit row for ${label}`);
    r.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  };
  const setLabel = (v) => {
    const e = doc.getElementById("f-clabel");
    e.value = v;
    fire2(e, "change");
  };
  const setPipe = (v) => {
    const e = doc.getElementById("f-duct-pipe-0");
    e.value = v;
    fire2(e, "change");
  };
  const setKind = (v) => {
    const e = doc.getElementById("f-kind");
    e.value = v;
    fire2(e, "change");
  };
  condRow("Zentralkabel");
  setLabel("Leerrohr DN 50 + Glasfaser"); // as generated from the catalogue template
  setKind("cable");
  assert.match(
    doc.getElementById("f-clabel").value,
    /^1 × Cat6A \(ohne Rohr\)$/,
    "the template name follows along",
  );
  setKind("trench");
  setPipe("dn63");
  assert.match(
    doc.getElementById("f-clabel").value,
    /^Leerrohr DN 63 \+ 1 × Cat6A$/,
    "and stays automatic",
  );
  setLabel("Zur Garage");
  setPipe("dn50");
  assert.equal(doc.getElementById("f-clabel").value, "Zur Garage", "a typed name stays put");
  setLabel("Zentralkabel");

  // --- Consistency: every mutation updates the finding and the ring --------
  jbRow("S1");
  click(doc.getElementById("f-gearx-0"));
  camRow("K1");
  // S1 is empty, so the cascaded S7 feeds it — but S7 itself now hangs off nothing
  assert.match(
    linkTxt(),
    /Versorgt über S7, aber S7 hat keinen Uplink/,
    "without a device in S1 the cascade delivers nothing anymore",
  );
  assert.ok(
    doc.querySelector('#g-markers .marker[data-id="k1"] circle.alert.err'),
    "and the camera gets a ring",
  );
  doc.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
  );
  camRow("K1");
  assert.match(linkTxt(), /Versorgt über S1/, "Ctrl+Z brings back the device and the finding");
  assert.ok(
    !doc.querySelector('#g-markers .marker[data-id="k1"] circle.alert'),
    "the ring disappears with it",
  );
  // Removing the cable from the conduit: then nothing leads there anymore
  activate(/Elemente/);
  [...doc.querySelectorAll("#l-conds .lrow")]
    .find((r) => r.querySelector(".t").textContent.startsWith("Kupfer"))
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  click(doc.getElementById("f-cabx-0-0"));
  camRow("K1");
  assert.match(
    linkTxt(),
    /Kein Kabel bis hierher/,
    "without a cable in the conduit, K1 is really unconnected",
  );
  doc.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
  );
  camRow("K1");
  assert.match(linkTxt(), /Versorgt über S1/, "and Ctrl+Z restores it");
  // Deleting a point: the cable stays put, the source is gone
  jbRow("S1");
  click(doc.querySelector("#pane-sel .selhead #f-del"));
  camRow("K1");
  assert.match(linkTxt(), /Kabel endet an/, "after deleting the point, the cable ends in nothing");
  doc.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
  );
  camRow("K1");
  assert.match(linkTxt(), /Versorgt über S1/, "Ctrl+Z brings back the point and the finding");

  // --- Housing: data sheet behind the ⓘ, not in the panel -------------------
  jbRow("J9");
  assert.equal(doc.querySelector("#pane-sel .product"), null, "no product box in the point panel");
  assert.ok(doc.getElementById("f-modeli"), "the housing select has an ⓘ button next to it");
  click(doc.getElementById("f-modeli"));
  assert.match(
    doc.getElementById("infoHead").textContent,
    /Kabelschacht/,
    "the ⓘ button opens the housing's data sheet",
  );
  assert.ok(doc.querySelector("#infoBody .product"), "with a product box");
  doc.getElementById("infoClose").click();
  const hous = doc.getElementById("f-model");
  hous.value = "indoor";
  fire2(hous, "change");
  click(doc.getElementById("f-modeli"));
  assert.match(
    doc.getElementById("infoHead").textContent,
    /Innen/,
    "after switching, the ⓘ shows the new housing",
  );
  assert.ok(
    !/Kabelschacht/.test(doc.getElementById("infoHead").textContent),
    "and not the old one anymore",
  );
  doc.getElementById("infoClose").click();
  hous.value = "shaft";
  fire2(hous, "change");
  // The device and cable rows carry the ⓘ in the action column, not on the text
  jbRow("S1");
  assert.ok(doc.querySelector("#f-gears .cabrow > button.ico"), "the ⓘ is a button in the row");
  assert.equal(
    doc.querySelector("#f-gears .cabrow .n button"),
    null,
    "and no longer hangs off the name",
  );

  // --- Head end: catalogue tab with no map ---------------------------------
  activate(/Bauen/);
  const gearTab = doc.querySelector('#cat-tabs [data-tab="gear"]');
  assert.ok(gearTab, 'the "Head end" tab is present');
  gearTab.click();
  assert.ok(doc.querySelectorAll("#cat-gear .item").length >= 10, "head end catalogue populated");
  assert.ok(
    !/USW Flex/.test(doc.getElementById("cat-gear").textContent),
    "switches sit on the map, not here",
  );
  // The router already sits in the plan, so an item here counts with no router role.
  const unvr = doc.querySelector('#cat-gear [data-kind="gear"][data-key="unvr"]');
  assert.ok(unvr, "UNVR in the catalogue");
  unvr.click();
  assert.equal(doc.getElementById("f-qty").value, "1", "the first click plans in one unit");
  assert.equal(
    doc.querySelector("#pane-sel .product"),
    null,
    "here too the data sheet sits in the dialog",
  );
  doc.getElementById("f-info").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.match(
    doc.querySelector("#infoBody .product img").getAttribute("src"),
    /^https:\/\/cdn\.ecomm\.ui\.com\//,
    "imgUrl() takes the image from the catalogue, not the /products/ path",
  );
  doc.getElementById("infoClose").click();
  assert.equal(
    unvr.getAttribute("aria-pressed"),
    null,
    "no placement mode, so no toggle state either",
  );
  doc.querySelector('#cat-gear [data-key="unvr"]').click();
  assert.equal(doc.getElementById("f-qty").value, "2", "a second click bumps the count");

  activate(/Elemente/);
  const gearRows = [...doc.querySelectorAll("#l-gear .lrow")];
  assert.equal(gearRows.length, 2, "the head end sits as its own section in the element list");
  const unvrRow = gearRows.find((r) => /UNVR/.test(r.textContent));
  assert.match(unvrRow.textContent, /2 ×/, "the quantity sits on the row");
  unvrRow
    .querySelector(".del")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(doc.querySelectorAll("#l-gear .lrow").length, 1, "the bin takes the item back out");

  // --- Snapping is a change, even with no distance travelled -----------
  const pickFrei = () => {
    activate(/Elemente/);
    [...doc.querySelectorAll("#l-conds .lrow")]
      .find((r) => /Frei/.test(r.textContent))
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  };
  pickFrei();
  const freeEnd = () => doc.querySelectorAll("#g-handles .vtx")[1];
  assert.ok(!freeEnd().classList.contains("bound"), "the end hangs free at first");
  freeEnd().dispatchEvent(
    new dom.window.MouseEvent("pointerdown", { bubbles: true, clientX: 7, clientY: 7 }),
  );
  doc
    .getElementById("mapwrap")
    .dispatchEvent(
      new dom.window.MouseEvent("pointermove", { bubbles: true, clientX: 7, clientY: 7 }),
    );
  await new Promise((r) => setTimeout(r, 60)); // pointermove runs throttled via requestAnimationFrame
  dom.window.dispatchEvent(new dom.window.MouseEvent("pointerup", { bubbles: true }));
  assert.ok(freeEnd().classList.contains("bound"), "after releasing it's snapped and redrawn");
  // A single Ctrl+Z must hit exactly this binding. Without its own history
  // entry it would instead undo the step before it — the deleted
  // head-end item. That's exactly what the difference hinges on.
  doc.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
  );
  pickFrei();
  assert.ok(!freeEnd().classList.contains("bound"), "Ctrl+Z undoes the binding");
  assert.equal(
    doc.querySelectorAll("#l-gear .lrow").length,
    1,
    "and only that — the deleted item stays deleted",
  );

  // --- Switching plans and importing: the finding gets recomputed --------
  assert.ok(
    doc.querySelectorAll("#g-markers circle.alert").length > 0,
    "findings sit on the map beforehand",
  );
  activate(/Elemente/);
  click(doc.getElementById("l-new"));
  assert.equal(doc.querySelectorAll("#g-markers .marker").length, 0, "a new plan starts empty");
  assert.equal(
    doc.querySelectorAll("#g-markers circle.alert").length,
    0,
    "and without the old rings",
  );
  // Importing an old state: house connection without gear, switch still as the point's model
  const OLD = {
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
  doc.getElementById("l-file").onchange({
    target: { files: [{ text: () => Promise.resolve(JSON.stringify(OLD)) }], value: "" },
  });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(
    doc.querySelectorAll("#g-markers .marker").length,
    3,
    "the imported plan is on the map",
  );
  pickHub();
  assert.equal(
    doc.getElementById("f-gears").querySelectorAll(".cabrow").length,
    0,
    "an old house connection with no gear arrives as an empty list, not an error",
  );
  assert.match(
    linkTxt(),
    /UniFi Cloud Gateway Fiber/,
    "the router from the old state still applies",
  );
  camRow("K");
  assert.match(linkTxt(), /Versorgt über S/, "and the finding gets computed for the new plan");

  assert.equal(
    errors.length,
    0,
    `runtime error after interacting: ${errors.map((e) => e.message).join(" | ")}`,
  );
  dom.window.close();
}
console.log(
  "ok — connections are derived (source, distance, PoE, rings), the head end is a catalogue tab",
);

// --- Distributing fibre further and power at the point -----------------------------
// A dedicated boot: a switch with several SFP cages passes the fibre on, and
// a device with its own power adapter in a buried shaft needs 230 V there.
{
  const jsdom = await import("jsdom");
  const { JSDOM } = jsdom;
  const errors = [];
  const FIXTURE = {
    name: "Strom und Faser",
    sub: "",
    lang: "de",
    budget: 3000,
    earthwork: 0,
    seq: 9,
    geo: { e0: 356448.6, n0: 5645366.7 },
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
      // Four SFP cages: one fibre arrives, two continue on — nothing gets spliced.
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
      // The same fan-out on only two cages: the branches are there, the count isn't.
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
      // Power at the point: a shaft without a power cable, a shaft with one, and the same device indoors.
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
      // PoE-powered: no power adapter needed, but 15 W out of the feeder's budget.
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
      // Switch with a power adapter in the shaft: here there's a PoE-powered counterpart.
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
      // The power cable covers the need at the point — it does no more than that here.
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
  const dom = new JSDOM(html, {
    url: `${base}/planner`,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    resources: "usable",
    virtualConsole: new jsdom.VirtualConsole().on("jsdomError", (e) => errors.push(e)),
    beforeParse(win) {
      try {
        win.localStorage.clear();
        win.localStorage.setItem("sl-plan", JSON.stringify(FIXTURE));
      } catch {}
    },
  });
  if (!dom.window.ResizeObserver) {
    dom.window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  const proto = dom.window.SVGSVGElement.prototype;
  proto.createSVGPoint = function () {
    return { x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) };
  };
  proto.getScreenCTM = function () {
    return { inverse: () => ({}) };
  };
  await new Promise((r) => dom.window.addEventListener("load", r));
  await new Promise((r) => setTimeout(r, 400));

  const doc = dom.window.document;
  assert.equal(
    errors.length,
    0,
    `runtime error while booting: ${errors.map((e) => e.message).join(" | ")}`,
  );
  const menu = doc.getElementById("viewMenu");
  const activate = (re) => {
    menu.open = true;
    menu.dispatchEvent(new dom.window.Event("toggle"));
    const entry = [...doc.querySelectorAll("#viewList button")].find((b) => re.test(b.textContent));
    assert.ok(entry, `menu entry for ${re}`);
    entry.click();
  };
  const jbRow = (label) => {
    activate(/Elemente/);
    const r = [...doc.querySelectorAll("#l-jbs .lrow")].find(
      (x) => x.querySelector(".b").textContent === label,
    );
    assert.ok(r, `row for ${label}`);
    r.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  };
  const linkTxt = () => doc.getElementById("f-link").textContent;
  const ring = (id, cls) =>
    doc.querySelector(`#g-markers .marker[data-id="${id}"] circle.alert${cls || ""}`);

  // --- Distributing fibre further ---
  // A device with several SFP cages is a fibre source: one uplink in, two out.
  jbRow("F1");
  assert.match(linkTxt(), /Uplink über H1/, "F1 hangs off the head end over fibre");
  assert.ok(!/SFP-Schacht/.test(linkTxt()), "three fibres onto four cages add up");
  assert.ok(!ring("f1"), "and give no ring");
  for (const label of ["F2", "F3"]) {
    jbRow(label);
    assert.match(linkTxt(), /Uplink über H1/, `${label} reaches the head end via F1`);
    assert.match(linkTxt(), /Glasfaser/, `${label} hangs off the fibre passed on`);
    assert.ok(!ring(label.toLowerCase()), `${label} is cleanly connected`);
  }
  // Only once more fibres arrive than there are cages does a finding show up —
  // the branches themselves stay connected.
  jbRow("G1");
  assert.match(linkTxt(), /3 Faserkabel auf 2 SFP/, "three fibres onto two cages don't add up");
  assert.ok(ring("g1", ".warn"), "that's a warning, not an error");
  jbRow("G2");
  assert.match(linkTxt(), /Uplink über H1/, "the branch is still on the network regardless");

  // --- Power at the point ---
  jbRow("M1");
  assert.match(linkTxt(), /M1: Medienkonverter/, "the finding names the point and the device");
  assert.match(linkTxt(), /braucht 230 V/, "a converter in a buried shaft needs power");
  assert.ok(ring("m1", ".warn"), "yellow ring, not an error");
  jbRow("M2");
  assert.ok(!/braucht 230 V/.test(linkTxt()), "with an NYY-J in the conduit, power is there");
  assert.ok(!ring("m2"), "and the point is clean");
  jbRow("M3");
  assert.ok(!/braucht 230 V/.test(linkTxt()), "indoors the outlet is assumed");
  jbRow("P1");
  assert.ok(!/braucht 230 V/.test(linkTxt()), "a PoE-powered switch needs no outlet");
  assert.ok(!ring("p1"), "and no ring");
  // Instead it draws from the feeder's budget — just like a camera.
  jbRow("F2");
  assert.match(linkTxt(), /15 von 196 W/, "the PoE-powered switch loads F2's budget");
  assert.match(linkTxt(), /5 von 8 belegt/, "and occupies a port there like the other points");

  // Recommendation: instead of a power adapter in the shaft, a device that hangs off the PoE cable.
  jbRow("A1");
  assert.match(linkTxt(), /braucht 230 V/, "the switch in the shaft has no power");
  {
    const adv = doc.getElementById("f-jb-advice");
    assert.ok(adv && !adv.hidden, "a recommendation sits there");
    assert.match(
      adv.textContent,
      /USW Flex \(Switch, außentauglich\) \(89 €\)/,
      "it names the cheapest PoE-powered counterpart with a PoE output",
    );
    assert.match(adv.textContent, /46 W/, "and how much PoE it passes on");
  }
  jbRow("M2");
  assert.ok(
    doc.getElementById("f-jb-advice").hidden,
    "where the power is already there, no recommendation shows",
  );

  // The data sheet says so on the device itself too.
  jbRow("P1");
  doc
    .getElementById("f-geari-0")
    .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.match(
    doc.getElementById("infoBody").textContent,
    /Stromversorgung/,
    "the data sheet lists the power supply",
  );
  assert.match(doc.getElementById("infoBody").textContent, /PoE/, "and says where it comes from");
  doc.getElementById("infoClose").click();

  assert.equal(
    errors.length,
    0,
    `runtime error after interacting: ${errors.map((e) => e.message).join(" | ")}`,
  );
  dom.window.close();
}
console.log("ok — fibre gets passed on at the switch, power at the point gets checked");

// --- Home page and guide --------------------------------------------
{
  const home = await (await fetch(`${base}/`)).text();
  assert.match(home, /id="startGeo"/, "home page offers the address search");
  assert.match(home, /id="planFile"/, "home page accepts a plan file");
  assert.match(home, /id="resumeCard"/, "home page can offer the last state");
  assert.ok(
    !/Flurstück \d/i.test(home) && !/[A-ZÄÖÜ][a-zäöü]+ \d+ · [A-ZÄÖÜ]/.test(home),
    "home page is no longer tied to one property",
  );
  assert.match(home, /href="\/help"/, "home page links to the guide");
  assert.match(home, /id="siteLang"/, "home page has the language toggle");
  assert.match(home, /sl-lang/, "home page uses the same language key as the planner");
  assert.match(home, /id="planList"/, "home page lists the existing plans");
  assert.match(home, /#new=1/, "starting fresh creates a new plan");
  assert.match(
    home,
    /href="\/planner#new=1"[^>]*data-i18n="foot\.blank"/,
    "opening an empty plan must not repeat the last state",
  );
  const guide = await fetch(`${base}/help`);
  assert.ok(guide.ok, "/help is reachable");
  const guideHtml = await guide.text();
  assert.match(
    guideHtml,
    /Glasfaser wird am Abzweig nicht geteilt/,
    "the guide explains the fibre rule",
  );
  assert.match(
    guideHtml,
    /Fibre is not split at a branch/,
    "the guide is also available in English",
  );
  assert.match(guideHtml, /need 230 V on the spot/, "power at the point is also there in English");
  assert.match(guideHtml, /id="siteLang"/, "the guide has the same language toggle");

  {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM(guideHtml, { url: `${base}/help`, runScripts: "dangerously" });
    await new Promise((r) => dom.window.addEventListener("load", r));
    const d = dom.window.document;
    assert.notEqual(
      d.querySelector('[data-i18n="d.v"]').textContent.trim(),
      "—",
      "the guide fills in the explanations (the script ran before the content)",
    );
    assert.ok(
      /Glasfaser/.test(d.querySelector('[data-i18n-html="p.2"]').textContent),
      "the guide fills in HTML paragraphs",
    );
    assert.ok(
      /230 V/.test(d.querySelector('[data-i18n-html="p.mains"]').textContent),
      "the guide explains power at the point",
    );
    dom.window.close();
  }
}
console.log("ok — home page leads into the planner, /help explains it");

// --- Server-side store ------------------------------------------------------
const serverDb = lift("serverDb", "async function ");
globalThis.fetch = (
  (orig) => (url, init) =>
    orig(new URL(url, base), init)
)(globalThis.fetch);

const db = await serverDb();
assert.ok(db, `no server-side store reachable — is "task serve" running on ${base}?`);

const doc = db.doc("plan/current");
const before = await doc.get();

const probe = { items: [{ kind: "hub", id: "check" }], conduits: [], budget: 42 };
await doc.set(probe);

const after = await doc.get();
assert.ok(after.exists, "get() returns nothing after set()");
assert.equal(after.data().budget, 42);
assert.equal(after.data().items[0].id, "check");
assert.ok(after.data().savedAt, "savedAt is missing");

// Write back the previous state, so the check doesn't break anything.
if (before.exists) await doc.set(before.data());

console.log("ok — /api/state saves and returns the state");
