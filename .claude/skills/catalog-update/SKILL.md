---
name: catalog-update
description: Add, change, price-check or deprecate a product in the Sightline catalogue (src/catalog/<kind>-<id>/product.json). Use when asked to add a camera, access point, switch, housing, router or accessory, to refresh prices, to fix a vendor or Amazon link, or to mark a product deprecated or end-of-life.
---

# Updating the product catalogue

Every product is one folder: `src/catalog/<kind>-<id>/product.json`, optionally
with an `image.webp` beside it. `src/catalog/index.ts` loads them all with
Vite's eager glob and rebuilds `CAMS`, `APS`, `JUNCTIONS` and `INFRA` in the
shape the planner has always used. Nothing else in the planner needs touching.

`src/catalog/schema.ts` is the file format and `src/catalog/schema.json` the
generated copy your editor validates against. Read the types before writing a
file — they carry the reasons, not just the names.

## The one rule

**Verify, never guess.** Every price, URL, ASIN and port count comes from the
vendor's own page in this session. A field nobody could confirm is left out.
Absent means "unverified"; `false` means "the vendor says no". Those are
different answers and the UI renders them differently — a missing `open` shows
a grey "—", a `false` shows a yellow warning.

## Adding a product

1. **Pick the kind and the id.** `kind` is `cam`, `ap`, `jb` or `infra`. The id
   is lower-case kebab, and for a third-party vendor it carries the vendor
   prefix the neighbours use (`reolink-rlc-810a`, `omada-eap610`). The folder is
   `<kind>-<id>` — the test fails if it is not.

2. **Copy the nearest neighbour's file** and edit it. That gets the field order,
   the `$schema` pointer and the house style for free.

3. **Fill the top level:** `vendor`, `status: "current"`, `order`, `name`,
   `price`, `priceDate`, `description`, `useCases`, `caveats`, `links`, `img`,
   `tags`. `order` places the entry inside its kind — pick a number between its
   neighbours (they go in tens, so there is room).

4. **Fill `specs`** with what the planner computes on. These are *curated*
   numbers, not a copy of the data sheet:
   - a housing's `ports` counts conduit openings, not RJ45;
   - `sfp` on a router means **usable on the LAN side** (a FRITZ!Box SFP cage is
     the WAN port → `false`);
   - `poePorts` is what a PoE injector passes on (it has two jacks, one output);
   - `sfpPorts` on an SFP module is `0`: it fills a cage, it does not add one.

5. **Add the vendor facts** where the page publishes them: `ports` (the real
   connector list), `poeIn`, `beam` for an access point, and for a camera `open`
   and `codecs`.

6. **Run the checks** (below) and look at the card, the hover and the ⓘ dialogue
   in the running planner.

### Verifying a link

```sh
curl -sL -o /dev/null -w '%{http_code} %{url_effective}\n' -A 'Mozilla/5.0' '<url>'
```

`links.vendor` is either a path under `https://eu.store.ui.com/eu/en/category/`
(UniFi) or an absolute URL (everyone else). A 200 that redirects to a different
product is a failure, not a pass — read the effective URL.

`links.amazon` must be exactly `https://www.amazon.de/dp/<10-char ASIN>`, and
the listing must be the product itself. If it is only an equivalent substitute,
set `links.amazonSimilar: true` — that changes the link's title so nobody buys
the wrong thing in good faith. If amazon.de answers with a bot check and you
cannot see the listing, **leave `amazon` out**.

### Pictures

`img` is the vendor's own URL, normally the `og:image` of the product page.
`ocx exec -- task images` fills it in for every product that has a vendor page
and no picture yet. The repository holds no product images: the CDNs serve
500 kB PNGs and a hundred of those do not belong in a planner. A local
`image.webp` in the product folder wins over `img` when one exists — convert it
yourself (`cwebp -q 80 -resize 480 0 in.png -o image.webp`, 60 kB ceiling) or
let `node tools/fetch-images.mjs --download` fetch one that is already small
enough.

## Refreshing prices

Prices live only in the product files. When you touch them:

- set `priceDate` to the month you checked (`YYYY-MM`) — the test insists every
  product carries the same one, so a price round is all-or-nothing;
- carry the same date into the cost-tab note (`cost.bom.note` in
  `src/i18n/de.ts` and `en.ts`), the Markdown export and `docs/PLAN.md`;
- `tools/check.mjs` fails if the date is missing anywhere.

## Deprecating a product

Nothing is deprecated today; the machinery is in place for when something is.

1. Set `status` to `"deprecated"` (still sold, no longer recommended) or
   `"eol"` (no longer available), and add `successor: "<id of the replacement>"`
   when there is one. The successor must exist in the same kind.
2. Change nothing else. **Do not delete the folder.** Plans in someone's browser
   and in a share link still name that id, and they have to keep resolving.

What happens then, without any further code: the product disappears from the
catalogue list, from the "add device" select and from the router select; the
"show deprecated" chip brings it back; the element that already uses it keeps it
in its own model select; and the data sheet gains a badge naming the successor.

## Checks before committing

```sh
ocx exec -- task catalog:schema   # only after editing src/catalog/schema.ts
ocx exec -- task test             # unit: schema, ids, de/en parity, port bounds
ocx exec -- task check            # the full chain incl. Playwright
ocx exec -- task build
```

`task check` needs no running server. If the dev server on :4321 is already up,
note that it caches the glob: a *new* product folder may not show until it is
restarted, while `task build` and the preview always see it.

### Checklist

- [ ] folder is `<kind>-<id>`, id is unique inside the kind
- [ ] `$schema` is `"../schema.json"`, the editor shows no error
- [ ] `name`, `description`, `useCases`, `caveats`, `tags`, `mount` carry **both**
      `de` and `en`
- [ ] `price` verified on the vendor page today, `priceDate` matches the rest of
      the catalogue
- [ ] `links.vendor` returns 200 and lands on this product
- [ ] `links.amazon` is a verified `/dp/<ASIN>` or absent
- [ ] `specs` reflects the planner's reading, not a raw copy of the data sheet
- [ ] `ports` is the real connector list; `specs.ports` lies between its
      downstream ports and its total
- [ ] unverified fields are **absent**, not guessed
- [ ] `order` puts the entry where it belongs in its kind
- [ ] unit tests, `task check` and `task build` all pass
