// Fetches the product image URLs from the UniFi store and writes them as
// `img:` into the catalogues in src/planer/catalogs.ts.
//
// Why just the URL and not the file: the CDN serves PNGs around 500 kB
// and ignores size parameters. Twenty products would be ten megabytes
// in the repo, and none of it belongs there.
// Anyone who wants the images locally puts them in public/products/ (see the
// README there); imgUrl() then uses the local path.
//
// Usage:  ocx exec -- node tools/fetch-images.mjs [--dry]
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../src/planer/catalogs.ts", import.meta.url);
const BASE = "https://eu.store.ui.com/eu/en/category/";
const dry = process.argv.includes("--dry");

let html = readFileSync(FILE, "utf8");

// oxfmt writes catalogs.ts one property per line and drops quotes from keys
// that are valid identifiers ("shaft-s" stays quoted, `shaft` doesn't). So a
// catalogue entry is matched top to bottom, not on one line: from its
// 2-space-indented `key: {` down to the matching 2-space-indented `},` —
// nested objects (`note: { … }`, `tags: { … }`) always sit deeper than that.
const ENTRY_RE = /^ {2}(?:"([a-z0-9-]+)"|([a-z][a-z0-9]*)): \{\n([\s\S]*?)\n {2}\},?$/gm;

const rows = [];
for (const m of html.matchAll(ENTRY_RE)) {
  const key = m[1] ?? m[2];
  const body = m[3];
  if (/(^|\n)\s*img:\s*"/.test(body)) continue; // already has an image
  const url = body.match(/^([ \t]*)url:\s*"([^"]+)"/m);
  if (!url) continue; // no store page (e.g. a housing with no vendor link)
  rows.push({ key, indent: url[1], url: url[2] });
}

if (!rows.length) {
  console.log("nothing to do — all entries already have an image");
  process.exit(0);
}

if (dry) {
  console.log(`${rows.length} entries would be checked (--dry, no requests made):`);
  for (const r of rows) console.log(`  ${r.key}: ${BASE}${r.url}`);
  process.exit(0);
}

const found = [];
for (const r of rows) {
  const page = BASE + r.url;
  try {
    const res = await fetch(page, { headers: { "user-agent": "Mozilla/5.0 (sightline)" } });
    if (!res.ok) {
      console.log(`  ${r.key}: HTTP ${res.status}`);
      continue;
    }
    const body = await res.text();
    const m = body.match(/<meta property="og:image" content="([^"]+)"/i);
    if (!m) {
      console.log(`  ${r.key}: no og:image`);
      continue;
    }
    found.push({ key: r.key, indent: r.indent, img: m[1] });
    console.log(`  ${r.key}: ${m[1]}`);
  } catch (e) {
    console.log(`  ${r.key}: ${e.message}`);
  }
}

let n = 0;
for (const f of found) {
  // Anchor on this entry's own key so the img: line lands right above its
  // url: line, not some other entry's.
  const re = new RegExp(
    `(^ {2}(?:"${f.key}"|${f.key}): \\{\\n[\\s\\S]*?\\n)(${f.indent}url: ")`,
    "m",
  );
  if (!re.test(html)) continue;
  html = html.replace(re, `$1${f.indent}img: "${f.img}",\n$2`);
  n++;
}
writeFileSync(FILE, html);
console.log(`${n} entries got an img: added`);
