// Fills in the product pictures for src/catalog/<kind>-<id>/product.json.
//
// Two jobs, both opt-in per product:
//   (default)    look up the vendor page and write its og:image into `img`
//   --download   fetch that picture into the product's own folder as image.webp,
//                which the loader then prefers over the remote URL
//
// Why the URL is the normal case: the vendor CDNs serve PNGs around 500 kB and
// ignore size parameters. A hundred products would be fifty megabytes in the
// repo, and none of it belongs there. A local copy is worth it where the vendor
// URL rots or the picture has to survive offline — hence the 60 kB ceiling,
// which in practice only an already-webp asset passes.
//
// There is deliberately no image conversion here: that would mean sharp or
// libvips as a dependency for a job that runs by hand twice a year. Convert
// outside (`cwebp -q 80 -resize 480 0 in.png -o image.webp`) and drop the file
// into the product folder — the loader picks it up.
//
// Usage:  ocx exec -- task images          (URLs only)
//         ocx exec -- node tools/fetch-images.mjs --download
//         ocx exec -- node tools/fetch-images.mjs --dry
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const DIR = new URL("../src/catalog/", import.meta.url);
const UI_STORE = "https://eu.store.ui.com/eu/en/category/";
const UA = { "user-agent": "Mozilla/5.0 (sightline)" };
const MAX_WEBP = 60 * 1024;

const dry = process.argv.includes("--dry");
const download = process.argv.includes("--download");

const folders = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const products = folders.map((name) => {
  const file = new URL(name + "/product.json", DIR);
  return { name, file, p: JSON.parse(readFileSync(file, "utf8")) };
});

// A store path gets the UniFi prefix, an absolute address is used as it stands.
const pageOf = (p) =>
  p.links && p.links.vendor
    ? /^https?:/.test(p.links.vendor)
      ? p.links.vendor
      : UI_STORE + p.links.vendor
    : null;

// ---------------------------------------------------------------- og:image
const missing = products.filter(({ p }) => !p.img && pageOf(p));

if (dry) {
  console.log(`${missing.length} products have a vendor page but no image:`);
  for (const { name, p } of missing) console.log(`  ${name}: ${pageOf(p)}`);
  process.exit(0);
}

for (const { name, file, p } of missing) {
  try {
    const res = await fetch(pageOf(p), { headers: UA });
    if (!res.ok) {
      console.log(`  ${name}: HTTP ${res.status}`);
      continue;
    }
    const m = (await res.text()).match(/<meta property="og:image" content="([^"]+)"/i);
    if (!m) {
      console.log(`  ${name}: no og:image`);
      continue;
    }
    p.img = m[1];
    writeFileSync(file, JSON.stringify(p, null, 2) + "\n");
    console.log(`  ${name}: ${m[1]}`);
  } catch (e) {
    console.log(`  ${name}: ${e.message}`);
  }
}
console.log(`${missing.length} products checked for a vendor image`);

// ---------------------------------------------------------------- local copy
if (!download) process.exit(0);

let saved = 0;
for (const { name, p } of products) {
  if (!p.img) continue;
  try {
    const res = await fetch(p.img, { headers: UA });
    if (!res.ok) {
      console.log(`  ${name}: HTTP ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    // RIFF....WEBP — the four bytes at offset 8 are the only reliable marker.
    const webp = buf.length > 12 && buf.toString("ascii", 8, 12) === "WEBP";
    if (!webp || buf.length > MAX_WEBP) {
      const why = webp ? `${Math.round(buf.length / 1024)} kB > 60 kB` : "not webp";
      console.log(`  ${name}: skipped (${why}) — convert by hand, see the header of this file`);
      continue;
    }
    writeFileSync(new URL(name + "/image.webp", DIR), buf);
    saved++;
    console.log(`  ${name}: image.webp (${Math.round(buf.length / 1024)} kB)`);
  } catch (e) {
    console.log(`  ${name}: ${e.message}`);
  }
}
console.log(`${saved} local images written`);
