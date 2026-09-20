# Sightline — camera, Wi-Fi and conduit planner

Interactive planner for camera, Wi-Fi and conduit systems over aerial imagery and
cadastral data (Geobasis NRW). **The planner starts empty** — search a location,
place the house connection, get going.

The planner itself is still **a single HTML file with no build step**. Around it sits an
Astro website that serves the file and backs up the working state server-side.

## Starting up

```sh
ocx exec -- task serve     # → http://localhost:4321
```

| Path | Content |
|---|---|
| `/` | website (Astro, `src/pages/index.astro`) — this is where refinement happens |
| `/planner` | the planner (`src/pages/planner.astro` + `src/planer/boot.ts`) |
| `/help` | the long-form guide |

Top right shows the **active language** (click to switch). The **basemap** sits as a
layers button under the zoom buttons on the right side of the map.
Below zoom: **Layers** (aerial imagery, cadastre, cadastre overlaid, reload tiles), the
**eye** — toggles viewing cones, ranges, conduits, labels and cross-sections individually
off; export and print show exactly that — and below it the **gear icon**: symbol size, font
size, area opacity, conduit width and whether nearby elements collapse into clusters, plus
*Reset*. The setting belongs to the plan (`state.look`), survives a reload, travels with
the share link and also applies to image export and print. The **tools** (Select, Camera,
Access Point, Junction, House, Conduit, Cable) sit as a palette bottom left on the map; the
arrow below it reveals the names, the letter in the corner is the key.

The toolchain (pnpm, task, oxlint, oxfmt, lefthook, gitleaks) comes from `ocx.toml`;
without `ocx exec` it's missing from PATH. All tasks: `ocx exec -- task --list`.

## Multiple plans

Each plan lives on its own in the browser (`sl-plan:<id>`), alongside a list with name,
change time and element count (`sl-plans`), plus the most recently opened one
(`sl-current`). Top left next to the name, the arrow opens the **plan list**: switch,
delete, create a new plan. A single old `sl-plan` state migrates into the list
automatically on first start.

The keys used to start with `oh-` (the previous project prefix). `migrateKeys()` in
`src/site/storage.ts` renames them once, before anything reads: each `oh-*` key is copied
to `sl-*` where that name is still free, then the old one is dropped, and the old tile
cache `oh-wms-v1` is deleted. Planner and website call the same function — whichever page
is opened first does the work. Running it twice changes nothing.

Addresses in the page: `#new=1` creates a new plan, `#o=<id>` opens a specific one,
`#p=<data>` adopts a shared state as a **new** plan, `#ll=<lat>,<lon>&n=<name>` also sets
the house connection right away.

## Landing page and help

`/` is a router: **Start fresh** with address search and a suggestion list (Nominatim) —
clicking a hit creates a new plan, jumps there, sets the house connection and fills in the
plan name, address and parcel right away. Next to it, **Open plan** (a JSON file becomes
its own plan) and **Recently edited** with a date per plan.

`/help` is the long-form guide. Both pages share the same **DE/EN** toggle as the planner
and share the localStorage key `sl-lang` — the language stays the same across the landing
page, the guide and the app. In the planner, a **?** button top right holds the short
version with a link to the guide.

Both versions live in **one file per language**: `src/i18n/de.ts` and `src/i18n/en.ts`,
section `planner` for the short text (`help.*`) and section `help` for the long one (the
same name plus `.long`). A UI change therefore touches one file per language plus this
README — the two help texts can no longer drift apart in separate files.

## Publishing (GitHub Pages, static)

`dist/` **is** the finished static build — around 2 MB, every page prerendered. There is
no server part and no endpoint: the planner saves to localStorage, and the share link and
the JSON export carry a plan anywhere.

A push to `main` triggers `.github/workflows/deploy.yml` after green CI: it builds,
uploads `dist` as a Pages artifact, and publishes at
`https://sightline.herwig-systems.de` (`public/CNAME`, DNS already points at GitHub
Pages). No manual deploy task anymore — repo settings under *Settings → Pages*: Source
*GitHub Actions*, custom domain `sightline.herwig-systems.de`, *Enforce HTTPS* on.

## Saving

Three tiers, each optional:

1. **localStorage** — on every change, immediately. What's
   saved isn't just the plan but the whole working state: language, panel order and
   collapsed state, sidebar width, basemap and overlay, viewport and zoom, search text and
   filters, appearance (gear icon). A reload looks just like before.
2. **Share link** (`#p=…`) — the whole plan packed into the URL, no account, no server.
3. **JSON export** in the *Elements* tab, for copies and variants.

Verify: `ocx exec -- task check` (astro check, oxlint, vitest, Playwright, then the repo
assertions in `tools/check.mjs`). Nothing there needs a server running beforehand —
Playwright starts its own.

## Structure

```
src/
  pages/index.astro         the website
  pages/help.astro          the long-form guide
  pages/planner.astro       the planner page: markup, served at /planner
  planer/                   the app, split into flat modules (entry point boot.ts) — see CLAUDE.md for the layout
  i18n/de.ts, en.ts         all texts, one file per language: planner, website, guide
  components/               SiteHeader, SiteFooter, LangToggle, AddressSearch, PlanList
  site/                     what those components run: lang, storage, address search, plan list
  styles/tokens.css         design tokens, both themes, used by planner and website
  styles/planner.css        the planner's styles
  layouts/Base.astro        website layout, maps the tokens onto Pico's --pico-*
docs/
  DATA-MODEL.md             the planner's data model, cost formula, catalog maintenance
tests/
  e2e/                      Playwright against /planner, / and /help
  unit/                     vitest
tools/
  check.mjs                 repo assertions on the planner source (no server, no browser)
Taskfile.yml                serve / build / preview / lint / test / check / tidy / clean
ocx.toml                    toolchain: pnpm, task, oxlint, oxfmt, lefthook, gitleaks, node
```

## Scale

`PX_PER_M` in `src/planer/geo.ts` is set to **5.957 px per meter** — the sheet constant
of the start box (`HOME`). The number is deliberately left unchanged in the code —
changing it shifts every cable length and cost; that's a decision, not an incidental fix.

## Operation

| Tool | Key | Behavior |
|---|---|---|
| Select | V | click selects, drag moves, Del deletes |
| Camera | K | pick a model in the catalog, click on the map places it. Shift keeps the tool active |
| Access Point | A | same as camera |
| Junction / Gear | J | a location with a housing (shaft, box, cabinet, indoor) and the devices inside it |
| House | H | set the house connection. Properties: description, DSL/fiber and tier |
| Conduit | L | **trench with ducts.** Click points, Enter, right-click or double-click finishes, Esc discards. Ends snap onto any element. Draws the last-chosen template, default fiber in DN 50 |
| Cable | C | **cable run without a duct** — wall, basement, attic, overhead line. No trench, no excavation; several cables may share the same bundle |

A fiber draft that ends at a camera or an Access Point automatically switches to
**Cat6A** on completion — there's no SFP slot there; the planner says so in the hint line.
Anyone who really wants fiber changes it afterward in the selection panel.

A conduit is either a **trench** with 1 to 6 ducts — **each duct with its own type, own
price and own cables** — or a **cable run without a duct**: a bundle in which several
cables may lie side by side, with no trench and no excavation. The kind sits at the very
top of the selection panel and can be switched at any time. For a trench, a block per duct
follows below (duct type, add a cable, quantity, add a duct or remove it along with its
cables); for a cable run, just the cable list. This is drawn in **layers**: a pale trench,
a thin line per duct, next to it the cables of that duct as colored strands (copper
dashed). A cable run gets no trench. **Cross-sections** sit along the route — one circle
per duct side by side, with the cables inside as dots, a count above eight cables per
duct; clicking one selects the conduit. On long routes they repeat roughly every 220
screen points and keep their distance from ends and markers. The eye icon has its own
toggle for this, independent of the labels.

At a fiber end, a **recommendation** may appear below a point's device list: if there's a
media converter plus a switch without SFP there, it names the cheapest switch that can do
both — and only if it costs at most €30 more. Nothing gets changed by it.

Top left on the map, a field searches **address or place** (OpenStreetMap/Nominatim) and
jumps there — the planner is no longer tied to a single property. At the house
connection, **Adopt address** fetches the address for the current position.

Mouse wheel zooms, dragging on open space pans the viewport.
**Ctrl+Z** undoes, **Ctrl+Y** (or Ctrl+Shift+Z) redoes; the two arrows in the header do the
same.

A selected conduit shows point handles: **double-click on a point removes it,
double-click on the duct between two points inserts a new one** — this lets a route be
rerouted afterward.

**Right-click opens a context menu for whatever sits under the pointer** (`src/planer/menu.ts`):
on open ground place a camera, access point, junction or house connection there, start a
conduit or a cable there, centre the view; on an element its data sheet, a conduit or cable
from there, *Point at …* (the next click on the map turns the camera or access point
towards it, Esc cancels), duplicate, zoom to and delete; on a conduit insert a point,
select or delete it, on a point handle remove it or detach it from its element; on a group
its members one by one. While drawing there is no menu — a right-click finishes the
conduit there, the same as Enter. A long press does the same on a touch device; arrow
keys, Home/End and Enter operate the menu, Esc closes it.

A selected camera gets a dashed ring with a handle on it: dragging the handle rotates the
viewing direction, Shift snaps it to 15° steps. The slider next to it stays valid and
follows along while dragging. Cameras with 360° view have no handle.

## Naming, saving, sharing a plan

Title and subtitle top left are input fields — without a name the plan is called
*Untitled plan*, without a subtitle the scale is shown instead. At the house connection,
**Adopt parcel** fetches the data via an ALKIS `GetFeatureInfo` call at that position and
writes it into the subtitle (e.g. *Parcel 7, section 3 · Sample Village (Sample City) ·
1:1000*). On the right in the header are five buttons: **Undo · Redo · Load · Save ·
Share**.

**Share** puts the whole plan into the address: `#p=<deflate+base64url>`. No server, no
account — whoever opens the link sees exactly this state, including viewport, layout and
language. On load, the link wins over the local state. A full plan lands at around 2 KB
in the address.

## Layout

The interface sits on [dockview](https://github.com/dockview/dockview) (MIT, from npm).
Five panels — **Map, Selection, Build, Elements,
Cost** — can be placed side by side, stacked, detached and resized; each scrolls
independently. The layout is part of the saved state.

The website (landing page, guide) is built with [Pico CSS](https://picocss.com) (MIT) —
semantic HTML, ready-made tables, buttons and forms, dark mode. The colors come from the
same tokens as in the planner (`src/layouts/Base.astro`).

**View** in the header lists all panels: a closed one can be brought back there, *Reset
layout* restores the default.

Panel sizes belong to the panel, not the drop target: if one is dragged into a **new**
group, it gets back the width it had before, instead of dockview's 50/50 split. If it
lands in an **existing** group, the layout stays untouched and the panel simply takes on
that group's size.

Clicking in the catalog or the element list no longer rebuilds the panels — only the
values get updated. That's why the scroll position stays put and the selection panel
doesn't flicker.

The **Selection** panel shows only what you actually **do** there: the input fields, the
lists (devices at a point, conduits here, devices attached), and the connection status.
A click in the element list no longer switches anything away — and the panel stays short
enough to take in without scrolling.

The **data sheet** sits behind the **ⓘ**: next to the model, housing or router select, in
every device and cable row, and next to every *Add* select. The dialog always shows the
same thing: name, properties, unit price, **Good fit** / **Less suited**, the full text
and the product box with image, product page, Amazon link and retailer search. The
properties there are in a fixed order and rated: green with `✓` meets the planning spec,
yellow with `!` is a limitation you should know about.

Clicking a catalog model shows it in the **Selection** panel as a preview: data sheet,
**Good fit** / **Less suited**, product image and retailer links — without switching
pages. As soon as something on the map is selected, that takes priority.

**Browse without placing anything.** Every catalog card carries a small **ⓘ** top right
next to the price: it opens the same data sheet and adds nothing — clicking the card
itself still places or adds as before. Whoever rests the pointer on a card, a device or
cable row, or a select field gets a **hover card** after 350 ms: image, name, price, one
line of key figures and two sentences. It disappears on moving away, scrolling, clicking
and with `Esc`, stays within the window, and doesn't appear at all on touch devices —
there the ⓘ leads to the same content. A node, not state: none of it lives in `state`,
the share link or the export.

The **select fields** are grouped by task (`<optgroup>`, `cat.grp.*`): devices under
*Switch with PoE*, *Switch/converter without PoE*, *Power supply (injector, extender)* and
*Accessories (unpowered)*; housings under *Buried*, *Outdoor wall-mounted* and *Indoor*;
routers by manufacturer. After the name and price sits the key figure from `optHint()` —
`8× PoE · 52 W`, `4× SFP`, `IP54 · 6 ports`. The same row carries the hover card.

The **Build** panel is its own ribbon: **Cameras · Access Points · Gear · Hub ·
Conduits** (`tab.cat.*`; the gear tab's title is spelled out as *Junctions & Gear*,
`cat.jbs`), always just one category at a time, each with its own search field, an
**ⓘ** button next to it (an explanation of the category as a dialog, not as body text in
the panel) and its own badges (cameras: 4K, PoE class, Wi-Fi, IR, 180°/PTZ, indoor/outdoor
· APs: outdoor-rated, indoor, 6 GHz, range · Gear: housing, devices, unpowered, switch,
IP68). Clicking a model only selects it — the panel stays put, so does the scroll
position. The **Gear** tab is split into two groups: *Housings & Locations* for placing,
*Devices* for putting into a selected point. The palette tool for this is called
**Junction / Gear** (`tool.jb`, key J).

## Hub and accessories

Router, recorder, storage and small hardware have no position on the map, but are
otherwise ordinary catalog goods: **Hub** tab in the Build panel, a click bumps the count
by one, quantity and explanation then appear in the **Selection** panel, the trash icon
takes the item back out. They show up as their own section in the element list and, like
everything else, in the bill of materials and totals. The checkbox list in the cost panel
is gone.

Anyone using a FRITZ!Box as a router additionally needs a UNVR for the cameras — it
doesn't record anything itself. The UCG Fiber can do both, but only covers around five 4K
cameras. Storage rule of thumb: 1 to 1.5 TB per 4K camera and month for continuous
recording, roughly a third of that for motion-triggered.

**The house connection is a location like any other.** In the *Selection* panel it offers
a **router** choice (the same entries as in the *Hub* tab, one router per plan) and below
it **devices at the hub** — switch, media converter, splice box, exactly as at a junction.
From that, the planner computes what's actually possible there:

| Router | LAN ports | SFP for LAN | PoE output |
|---|---|---|---|
| UniFi Cloud Gateway Fiber | 4 | yes (one of the two SFP+) | 30 W |
| FRITZ!Box 7690 / 6690 | 4 | no (SFP is WAN) | – |
| FRITZ!Box 5690 Pro / 5590 | 5 | no (SFP is WAN) | – |
| FRITZ!Box 5530 | 3 | no (SFP is WAN) | – |

Below the device list sits a **recommendation** that comes from the plan, not the
catalog: missing router, missing SFP port for the incoming fiber, missing PoE for the
cameras at the house connection — or, if it all fits, what's planned is stated there. The
**ⓘ** in the header opens the buying guide for the hub.

Without a router the hub remains a cable point: no copper, no PoE, no uplink for the
switches. If fiber arrives there, it needs an SFP slot — on a FRITZ!Box that means a media
converter or switch as a device next to it. A camera directly at the house connection
draws its PoE from the router (UCG: 30 W, so exactly one) or from a PoE switch placed
there.

## Connections

Which device is attached to what is **derived by the planner from the plan** — none of it
is stored. The basis is the conduit ends: an end snapped onto an element carries that
conduit's cables to the device. Cat6A supplies cameras and access points with data and
PoE, fiber only ends at a switch or media converter with an SFP port. Cables pass through
passive junctions; at a switch one stretch ends and the next begins.

| Status | Meaning |
|---|---|
| red ring | no cable reaches here, fiber directly at the device, a cable ends at an empty point, or the source itself is attached to nothing |
| yellow ring | over 90 m of Cat6A, no PoE source, no uplink, PoE budget exceeded, no router at the hub, a cable with no counterpart at the junction, more fiber cables than SFP slots |

**Connected is not powered.** Previously every failure said "no cable reaches here" —
even when a cable did arrive and only the point at the other end supplied nothing. Now the
planner separates the two: *No cable reaches here* really means no cable, *Cable ends at
J3* means there's no switch and no router there, and *Powered via S2, but S2 has no
uplink* means the source itself doesn't reach the hub. Every message names the point and
the fix; device and point each report their own part instead of repeating each other.

At a junction **without gear**, the planner also counts the cable ends: cables passing
through balance out; one ending with no counterpart shows up as a warning — because a
junction passes through, it doesn't split. Whoever really needs to split adds a **splice
box**, which clears the balance. At a point **with** gear, it's checked whether the
incoming fiber cables even find enough SFP slots.

**Power at a point** is checked the same way: switch, media converter and injector bring
their own power supply and need 230 V there. Indoors and in a 19-inch rack, an outlet is
assumed; in a ground shaft or distribution cabinet an **NYY-J** must arrive via a conduit,
otherwise the point shows *needs 230 V*. Without a trench, a **PoE-fed device** helps — it
hangs off the same network cable as the camera and draws from the PoE budget of the
switch upstream; below the device list the planner suggests one when it fits.

The same statuses appear as a point in the element list, as a warning box in the cost
panel, in the Markdown export and on the print sheet. The **Selection** panel shows, per
device, the source, the distance and the conduits ending there; for a switch, additionally
the PoE budget, occupied ports and the devices attached — each one clickable.

## Junctions: housings and devices

A junction is **one location**, not a single part. It carries a **housing** and, inside
it, the **devices** that work there. Whoever needs a media converter *and* a switch in a
distribution box places one point for that, not two.

| Housings and locations | Power | For |
|---|---|---|
| DN 300 cable shaft | no | ducts end here, cables pass through, accessible later |
| Gel splice enclosure IP68 | no | cheapest junction, buried afterward |
| Outdoor distribution cabinet | no | above ground, room for gear |
| Indoor, wall or shelf | no | no housing, €0 — the device sits inside the building |

The same devices can also be placed into the **house connection** — a click in the
*Junction/Gear* catalog tab while the house connection is selected is enough. They show up
in the bill of materials and totals under *Junctions/Gear*.

| Devices at a point | Power | For |
|---|---|---|
| USW Flex / Lite 8 / Ultra 60W, Omada, MikroTik … | yes | SFP+ or copper in, PoE out |
| Media converter SM → RJ45, TP-Link MC220L | yes | exactly one device at a fiber end |
| Splice box IP68 | no | only when a fiber really needs to be split |

In the **Junction/Gear** catalog tab, both groups sit one below the other. Clicking a
**housing** starts placement mode as before. Clicking a **device** puts it into the
currently selected point; if none is selected, the next map click creates a new point
with that device (housing *Indoor*). In the **Selection** panel, devices appear as rows
with quantity, **ⓘ** and trash icon in the action column, followed by an add row with
**Select · ⓘ · +**. The cable rows in the conduit panel follow the same pattern.

A point **with no devices** is perfectly fine: cables just meet there. Fiber may end
there and pass through; copper, however, gets no source there. On the map, such a point
is an empty diamond — as soon as a powered device sits inside it, it fills in.

Price, PoE budget and ports of a point are the **sum of its devices** (housing plus
devices). If a media converter sits in front of a switch, only the switch's ports count —
the converter's port feeds in internally. In the bill of materials, housings appear per
model, with devices bundled across all points below them.

Older plans, where a switch itself was the point's model, get converted on load: housing
*Indoor* (€0), the old model as a device inside it. The total doesn't change.

Conduit ends snap onto **any** element (a diamond on the map) and **move along when it's
relocated**. Whoever deliberately drags an end away breaks the binding; pulling it back
onto the element snaps it in again.

## Ducts and cables

A conduit has a **kind**. *Conduit (trench)* is excavation plus ducts: it holds 1 to 6
ducts, **each with its own type** (DN 50 or DN 63) and therefore its own price per meter,
and its own cables inside each duct. A DN 63 for power next to a DN 50 for data in the
same trench is exactly the case this separation exists for. *Cable (no duct)* is a cable
run on a wall, in a basement, through an attic or as an overhead line: **no trench, no
duct, no excavation** — just the cable, and several cables may share a bundle. The
catalog buttons are templates for both and sit there in two groups.

A conduit's **name** follows along as long as it's automatic: a freshly drawn trench is
named after its ducts and cables, a cable run "Cable: 1 × Cat6A", and whoever changes the
kind afterward, swaps a duct or adds a cable sees the name follow immediately. Once you
type something yourself, that stays.

**Fiber is not split at a junction.** It runs through uncut; two destinations mean two
cables in the trunk duct, which split onto two ducts at the shaft. That's why the branch
to house 2 in the default plan has no cable of its own — it's already inside the trunk.
Whoever genuinely needs to split adds a splice box (passive, costs extra). An optical
splitter would be the wrong tool here: that belongs to PON, not to a point-to-point run
over SFP+.

## Basemap

Two WMS layers from Geobasis NRW, switchable via the layers button on the right side of
the map:

| Layer | Service |
|---|---|
| NRW aerial imagery (DOP) | `wms_nw_dop`, layer `nw_dop_rgb` |
| Official ALKIS (NRW) | `wms_nw_alkis` |

Plus, optionally, the cadastre half-transparent over the aerial imagery. The source is
Geobasis NRW (dl-de/zero-2-0); the planner shows the attribution bottom right. Without
internet, the map stays blank.

**The view isn't bounded.** `⌂` fits the viewport to your own plan; as long as there's
none, it shows an overview of about 2.5 km. The first start has no location — the address
search or the link from the landing page provides it.

**Symbols stay screen-sized.** Markers, point handles, conduit strokes and labels carry a
scale derived from the current zoom (`markerTransform()`, `refreshScale()`) and are
therefore equally easy to hit at 1 m as at 2 km. Only viewing cones and ranges stay to
scale — they're a statement about meters. Zooming doesn't redraw the map for this, it
only reapplies the transforms.

**Presentation: factors, not a rebuild.** The gear icon under the eye sets five values in
`state.look`: `size` scales everything drawn at screen size via `calcScale()`, `font`,
`alpha` and `line` hang as CSS variables (`--look-font`, `--look-alpha`, `--look-line`) on
`svg.map` and therefore also apply to the clone used for image export and PDF, `cluster`
toggles the clusters off. Only the cluster toggle triggers a redraw; everything else runs
through `refreshScale()` and `refreshOffsets()`. `look` deliberately does **not** sit in
`HIST_KEYS` — a slider isn't a work step and must not come back via Ctrl+Z.

**Clusters when zooming out.** If elements sit closer than 36 px together on screen, the map
draws a circle instead of the individual markers: the number inside is the count, the ring
around it shows a color segment per kind contained, a click zooms into the cluster. Conduits
ending at a member are drawn up to the cluster center (`displayPos()`) — the real point
stays what's saved. Only the currently selected element stays visible on its own; the
house connection may join a cluster. Viewing cones, ranges and conduits of the members stay
in place. This is **pure presentation** — the clusters themselves don't live in `state`;
only the toggle that turns them off sits there, as `look.cluster`.

**Back and forward in the browser step through the map views.** Every *jump* puts the
prior view into history: clicking a cluster, a row in the Elements or Selection panel, `⌂`,
a location search hit. Panning and scroll-wheel zooming don't do this — that would be
hundreds of entries. The address and hash stay untouched, so the share link (`#p=`)
doesn't get scrambled by it.

**Hover links the list and the map.** Pointing at a row in the Elements panel, or a
conduit/device row in the Selection panel, highlights the counterpart on the map — and
vice versa. This too is just a CSS class, not state.

The map works with tiles on a fixed UTM grid (512 px, requested at device resolution,
aerial imagery as JPEG). The grid ensures the same tile has the same address across pan
and zoom. At most eight requests run at once, each address is fetched exactly once, and
whichever tile is closest to the image center goes first. A coarser level stays in place
until the finer one is fully there — otherwise the empty background would flash through
while zooming.

The WMS sends **no** cache headers, so the browser would reload every tile again and
again. That's why tiles sit in the Cache API (`sl-wms-v1`) with a 30-day lifetime, plus a
store for the current session. **Reload tiles** in the layers menu discards both.

The georeference (EPSG:25832) hangs off `state.geo` per plan; a new plan gets its origin
at the searched address, and without an address, Cologne Cathedral sits at the center.

## Export

The export button top right bundles everything that leaves the planner:

- **Area** (`exp-area`, top of the dialog) — *Viewport* takes the map as currently
  visible, *Whole plan* zooms out far enough that everything fits (`exportBox("all")` via
  `contentBox()`, in the screen's aspect ratio). The toggle applies to **image and print
  sheet** together and isn't saved — it's back to *Viewport* every time the dialog opens.
- **Image** — double resolution, optionally with the cadastre overlaid; to the clipboard
  or as a PNG. The SVG clone with embedded WMS images is rendered onto a canvas via
  `<img>` (`renderPng`). Whatever the eye hides and the gear icon sets travels with it.
- **Print sheet** — A4 from the map (area as chosen) and the bill of materials, via "Save
  as PDF" in the print dialog. No PDF generator as a dependency.
- **Bill of materials** as text, **plan file** as JSON.
- **For an AI** — the whole plan as Markdown (`planMarkdown`): elements with position in
  meters relative to the house connection, models with data, conduits with length and
  contents, costs and review questions. For pasting into a conversation.

## Product images

In the **ⓘ dialog**, the product image sits full width, below it a row with **product
page** on the left and the retailer search on the right. The same row also shows the
catalog preview in the **Selection** panel while nothing is selected. There's no longer a
dedicated Amazon button: choosing **Amazon** in the retailer list goes straight to the
verified item if the catalog knows one, otherwise to the search. The addresses sit as
`amazon:` in the catalogs (`https://www.amazon.de/dp/<ASIN>`, verified 09/2026 — Amazon
swaps ASINs out, so double-check when in doubt). If an entry has `amazonSimilar: true`,
it's labeled **Amazon (similar)**: that's not the original item but an equivalent
substitute. The print sheet, PDF and Markdown both list the two addresses per product. The
magnifier bottom right opens the image in the dialog at full resolution (1500 px), with
`+` / `−` / mouse wheel to zoom and **Fit** to go back.

The image addresses sit as `img:` in the catalogs and point at the manufacturer's CDN.
`ocx exec -- task images` refreshes them (`tools/fetch-images.mjs`, reads the `og:image`
of the product pages). Deliberately **no** files in the repo: the CDN serves PNGs around
500 KB and ignores size parameters — twenty products would be ten megabytes. Whoever wants
local copies places them under `public/products/` and removes the `img:`.

## Products

The ⓘ dialog links directly to the product page in the UniFi EU store (`url` in the
catalog, all paths verified) and next to it to the search on Geizhals, Idealo, Amazon,
eBay and Kleinanzeigen.

Product images are optional: place a file at `public/products/<kind>-<key>.jpg` (see
`public/products/README.md`), and it appears next to the links.

## Future work (ideas)

- Move `PX_PER_M` to the measured 5.9055 (see Scale) — decision pending
- Clip the viewing cone against obstacles (building polygons)
- Factor in cable lengths inside buildings (switch → camera)
- Live prices via scraper/API instead of catalog constants
- Print view / PDF export of map + bill of materials
- Bill of materials and design concept as their own website pages
