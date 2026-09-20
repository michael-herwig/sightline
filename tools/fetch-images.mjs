// Fetches the product image URLs from the UniFi store and writes them as
// `img:` into the catalogues in src/planer/app.ts.
//
// Why just the URL and not the file: the CDN serves PNGs around 500 kB
// and ignores size parameters. Twenty products would be ten megabytes
// in the repo, and none of it belongs there.
// Anyone who wants the images locally puts them in public/products/ (see the
// README there); imgUrl() then uses the local path.
//
// Usage:  ocx exec -- node tools/fetch-images.mjs [--dry]
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../src/planer/app.ts", import.meta.url);
const BASE = "https://eu.store.ui.com/eu/en/category/";
const dry = process.argv.includes("--dry");

let html = readFileSync(FILE, "utf8");

// Every catalogue line with url: is a product. The key sits at the start of the line.
const rows = [...html.matchAll(/^(\s*)"([a-z0-9-]+)":\s*\{([^\n]*?)url:\s*"([^"]+)"/gm)]
  .map(([, indent, key, head, url]) => ({ key, url, head, indent }))
  .filter((r) => !/img:/.test(r.head));

if (!rows.length) {
  console.log("nothing to do — all entries already have an image");
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
    found.push({ key: r.key, img: m[1] });
    console.log(`  ${r.key}: ${m[1]}`);
  } catch (e) {
    console.log(`  ${r.key}: ${e.message}`);
  }
}

if (dry) {
  console.log(`${found.length} URLs found (--dry, nothing written)`);
  process.exit(0);
}

let n = 0;
for (const f of found) {
  const re = new RegExp(`("${f.key}":\\s*\\{[^\\n]*?)url: "`, "m");
  if (!re.test(html)) continue;
  html = html.replace(re, `$1img: "${f.img}", url: "`);
  n++;
}
writeFileSync(FILE, html);
console.log(`${n} entries got an img: added`);
