// Repo assertions. Nothing here boots a browser and nothing needs a server —
// these are the three things that are about the repository rather than about
// the code, so they have no place in a unit test.
//
// Everything that is about the planner's own data now lives in Vitest and runs
// against the real modules instead of against the source text:
//   tests/unit/catalogs.test.ts  DE/EN parity, /dp/<ASIN> links, housing vs.
//                                device, powerIn, empty defaultState, no place
//                                names in src/planer
//   tests/unit/geo.test.ts       UTM 32N against a fixed value, GEO_DEFAULT
//   tests/unit/links.test.ts     topology, PoE budget, head end, fibre onward
//   tests/unit/{migrate,conduit,costs,geom,clusters}.test.ts
// Behaviour in the browser is covered by tests/e2e (Playwright).
//
// Run:  ocx exec -- node tools/check.mjs   (or as part of `task check`)
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// --- Nothing secret in the build -------------------------------------------
// public/ is copied unchanged into dist/. Whatever lives there is public.
{
  const dir = new URL("../public", import.meta.url).pathname;
  const walk = (d, out = []) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f, out);
      else out.push(f);
    }
    return out;
  };
  const bad = walk(dir).filter((f) =>
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

// --- The price date is stated wherever prices are shown ---------------------
// Prices are researched by hand. A figure without a date is a figure nobody can
// judge, and the date drifts apart the moment one of these four is updated alone.
{
  const asOf = /09\/2026/;
  const wants = [
    ["src/planer/catalogs.ts", "the catalogue header"],
    ["src/planer/export.ts", "the Markdown export"],
    ["src/i18n/de.ts", "the cost tab note and the guide"],
    ["src/i18n/en.ts", "the cost tab note and the guide"],
  ];
  for (const [path, what] of wants) {
    const src = readFileSync(new URL("../" + path, import.meta.url), "utf8");
    assert.match(src, asOf, `no price date in ${path} — ${what}`);
  }
  for (const lang of ["de", "en"]) {
    const src = readFileSync(new URL(`../src/i18n/${lang}.ts`, import.meta.url), "utf8");
    assert.match(src, /"cost\.bom\.note":/, `cost.bom.note is missing in ${lang}`);
  }
}
console.log("ok — the price date is stated in catalogue, cost tab, export and guide");
