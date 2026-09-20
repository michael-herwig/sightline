// Repo checks for the planner source: nothing here boots a browser and nothing
// needs a running server. The assertions read src/planer/app.ts as text — they
// guard what must stay true about the shipped source itself.
//
// Run:  ocx exec -- node tools/check.mjs   (or as part of `task check`)
//
// TODO (step 3.4) — retired here, to come back as vitest units once the planner
// is split into modules. Until then Playwright (tests/e2e) covers the behaviour:
//   angleAt()            rotation handle angle math      -> tests/unit/geom.test.ts
//   offsetPath()         parallels in the trench         -> tests/unit/geom.test.ts
//   syncBonds()          conduit ends on an element      -> tests/unit/bonds.test.ts
//   snapTargets()        every element is a snap target  -> tests/unit/bonds.test.ts
//   UTM.fwd/inv          WGS84 <-> EPSG:25832 round trip -> tests/unit/geo.test.ts
//   links()              topology, PoE budget, head end  -> tests/unit/links.test.ts
//   fibre onward / power at the point                    -> tests/unit/links.test.ts
// Already covered by Playwright and therefore gone for good:
//   the two jsdom boots (language, ribbon, catalogue search, basemap)
//                                                        -> tests/e2e/boot.spec.ts,
//                                                           panels.spec.ts, basemap.spec.ts
//   home page and /help                                  -> tests/e2e/plans.spec.ts
// Gone with the static build: the server-storage round trip — that route no longer exists.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The planner's source. jsdom cannot run the module bundle, so everything below
// works on the text instead of on a live page.
const html = readFileSync(new URL("../src/planer/app.ts", import.meta.url), "utf8");

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
  "no location-specific data in src/planer/app.ts",
);
console.log("ok — default plan is empty, no third-party locations in the shipped state");

// --- Nothing secret in the build -------------------------------------------
// public/ is copied unchanged into dist/. Whatever lives there is public.
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

// --- The default origin is Cologne Cathedral, never a private location -----
{
  const geoDefault = html.match(/const GEO_DEFAULT = \{ e0: ([\d.]+), n0: ([\d.]+) \};/);
  assert.ok(geoDefault, "GEO_DEFAULT not found");
  assert.equal(+geoDefault[1], 356448.6, "GEO_DEFAULT.e0 is not Cologne Cathedral");
  assert.equal(+geoDefault[2], 5645366.7, "GEO_DEFAULT.n0 is not Cologne Cathedral");
}
console.log("ok — GEO_DEFAULT is the public default origin");

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
