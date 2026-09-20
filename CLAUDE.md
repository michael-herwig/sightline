# CLAUDE.md

Planner for a camera/Wi-Fi/conduit system on a property. Project name: Sightline.
Astro website plus the planner, both in one Astro build. UI and user help are bilingual DE/EN;
developer docs, code comments and commit messages are English.

## Read first

- `README.md` – start, structure, storage paths, operation
- `docs/DATA-MODEL.md` – state, catalogs, cost formula

## Toolchain

pnpm, task, oxlint, oxfmt, lefthook and gitleaks come from `ocx.toml`, not from the shell's
PATH. Every command goes through `ocx exec -- <cmd>`; add further tools via `ocx add`,
never install them globally. Run `ocx pull` once before the first run if `ocx exec` can't
find a tool.

```sh
ocx exec -- task --list    # overview
ocx exec -- task serve     # dev server, http://localhost:4321
ocx exec -- task lint      # astro check + oxlint
ocx exec -- task fmt       # oxfmt writes (src, tools, tests)
ocx exec -- task fmt:check # oxfmt checks without writing
ocx exec -- task test      # vitest (unit)
ocx exec -- task test:e2e  # playwright against /planner
ocx exec -- task build     # dist/
ocx exec -- task check     # lint → test → test:e2e → tools/check.mjs (needs no running server)
ocx exec -- task tidy      # remove Zone.Identifier cruft left by WSL
```

`lefthook install` (once, `ocx exec -- lefthook install`) sets up the pre-commit hook:
oxlint + oxfmt --check on the staged files, `gitleaks protect --staged`. Runs through
`tools/bin/oxc.sh` — ponytail: ocx.sh currently ships oxlint/oxfmt under their Rust target
triple instead of the short name (a packaging bug on ocx.sh's side), the wrapper finds them
via PATH regardless; drop it once ocx.sh fixes the metadata. CI (`.github/workflows/ci.yml`)
runs the same chain via `ocx-sh/setup-ocx`.

## Rules

- The planner is an Astro page: markup in `src/pages/planner.astro`, styles in
  `src/styles/planner.css` (tokens in `src/styles/tokens.css`), the app in `src/planer/app.ts`,
  loaded from the page via `<script>import "../planer/app.ts";</script>`. Astro bundles that
  as a module — nothing is vendored, nothing hangs off a global. The only third-party
  libraries are dockview (`import { createDockview } from "dockview"`, plus its stylesheet
  from `dockview/dist/styles/dockview.css`), jsPDF (`await import("jspdf")` inside the export
  handler, so the 400 KB only load when someone actually exports) and the Codicons font
  (`@vscode/codicons`, on request: all icons unified as `<i class="codicon codicon-<name>">`,
  no more inline SVGs). No further ones without discussion.
- `src/planer/app.ts` is still the old single-file planner **verbatim**, one IIFE with
  `// @ts-nocheck`. It's excluded from oxfmt (`.prettierignore`) and three oxlint rules are
  off for it (`.oxlintrc.json`) — both come back as the file is split into modules and typed.
  No new file may rely on either.
- The SVG `viewBox` must match the element's aspect ratio (`syncAspect`), otherwise the
  browser letterboxes and the whole map jumps whenever a panel changes width.
- Never call `renderMap()` while dragging. `applyDrag()` runs once per frame and only
  touches the affected nodes via `refreshItem` / `refreshConduit`; a full redraw happens
  only on release.
- **Symbols stay screen-sized.** Markers, clusters, point handles, conduit labels and the
  draft carry `translate(x y) scale(SCALE)` and their anchor as `data-sx`/`data-sy`
  (`markerTransform()`, `scaleAt()`); `applyView()` calls `refreshScale()`, which only
  reapplies these transforms — a zoom **never** triggers a redraw. Conduit strokes are
  measured via `vector-effect: non-scaling-stroke` in screen points, the `--sw` factor
  scales them up for export. Never use fixed map units for a symbol. Only viewing cones
  and ranges stay to scale.
- **Clusters are pure presentation, not state.** `buildClusters()` clusters elements within
  36 screen px of each other (only the selection stays on its own), `renderMap()` draws a
  `g.marker.cluster` for that; none of it lands in `state`, the share link or the export.
  After zooming, `clusterLater()` checks, debounced, whether the cluster membership changed.
  Conduit ends at a cluster member are drawn at the cluster center via `displayPos()` — only in
  the DOM. `state`, `syncBonds()` and `conduitCost()` see the real point.
- **View jumps belong in browser history, panning and zooming don't.** `jumpView()` (cluster
  click, `centerOn()`, ⌂, a location hit) freezes the prior view with `replaceState` and
  pushes the target via `pushState`; `popstate` with `slView` sets `view` and calls
  `applyView()`. Never pass a URL along — that would clobber `#p=` and `#new=1`.
- Hover between list and map is a **class** (`.hover`), not state and not a `renderMap()`
  call. It's lost on redraw — that's fine.
- Conduit point handles belong in `#g-handles`, above the markers, otherwise they're no
  longer grabbable under a camera.
- Conduit labels (lengths, name) sit in `#g-labels` between markers and handles, rotated
  along the duct and nudged next to the line. Inside the conduit itself they used to sit
  under the cone and camera. `refreshConduit()` and `renderMap()` must clean up this group
  too.
- The map's on-canvas controls (`.layers`, `.zoom`, …) must never trigger panning; see
  `ON_UI` in the pointerdown handler.
- **`initLayout()` measures `#dock` itself and hands the size to dockview.** dockview sizes
  its grid from a `ResizeObserver`, and under load that callback lands *after* the panels
  have been added: the grid lays out at 0 x 0, every group clamps to its 100 px minimum and
  never grows back — the map stays a sliver and everything collapses into one stack. So
  `dock.layout(host.clientWidth, host.clientHeight)` runs right after `createDockview()` and
  before the first `addPanel`. The bounded `requestAnimationFrame` loop above it only makes
  sure that measurement is real; it skips itself where there is no layout at all,
  so the planner still comes up in a headless environment.
- dockview detaches inactive panels from the document. That's why `$()` falls back to
  searching the remembered panel nodes — `document.getElementById` alone isn't enough.
- **A UI change is a help change.** Every change to tools, keys or workflows must land in
  *three* texts: `HELP` + `help.*` keys in `src/planer/app.ts` (short version in the
  `?` dialog), `src/pages/help.astro` (long version) and `README.md`. Otherwise the docs
  drift away from the interface, and the user is the first to notice.
- The website uses **Pico CSS** (`@picocss/pico`, imported in `src/layouts/Base.astro`):
  semantic elements (`<article>`, `role="group"`, `table.striped`, `.secondary.outline`)
  instead of custom button and table CSS. Colors run through the `--pico-*` variables,
  which are mapped there onto the planner tokens. Page `<style>` blocks are `is:global`:
  Astro scopes styles via `data-astro-cid`, and nodes a script creates (plan rows, address
  hits) don't get that attribute — that's exactly how the table once ended up unstyled.
  The planner itself is unaffected.
- The landing page (`src/pages/index.astro`) is a router, not a brochure: search an
  address, load a plan, resume the last one. Nothing property-specific — the planner is
  meant for general use. A loaded file enters the planner via `#p=`, so there is exactly
  one vetted path for taking on a foreign state.
- `.env.local` is git-ignored. Never prefix with `PUBLIC_`/`VITE_` — that ends up in the
  browser. Nothing secret under `public/`; `task check` verifies that.
- The build is `output: 'static'` and `dist/` gets published whole (GitHub Pages,
  `sightline.herwig-systems.de`, `.github/workflows/deploy.yml` after green CI on `main`).
  There is no server part and no API route — persistence is localStorage, share link and
  JSON export. Credentials only via `.env.local`, never into the repo.
- Product images do **not** live in the repo. `img:` in the catalog points at the
  manufacturer's CDN, `tools/fetch-images.mjs` (`task images`) refreshes it. 500 KB per PNG
  × 20 has no business in this repo.
- The UTM conversion (`UTM.fwd/inv`, EPSG:25832) is hand-rolled — no proj library for
  thirty lines of Transverse Mercator. `tools/check.mjs` checks it against a fixed value.
- Nominatim is a free third-party service: debounce input (450 ms), swallow errors
  silently, name the source. No API key, no bulk queries.
- The share link is `#p=<1|2><base64url>` — `2` = deflate-raw. On boot it wins over
  localStorage and the server. Everything in `state` travels with it.
- `openPanel()` leaves an already-active panel alone. dockview re-inserts on activation
  and calls `focus()` — both reset the panel area's scroll position to 0.
- `isDoubleTap()` detects double clicks on the map itself. A `dblclick` listener doesn't
  work there: the map redraws between the two clicks, so the second one hits a different
  node.
- Panels only rebuild their scaffold when the **signature** changes (`pane(id, sig,
  build)`); otherwise only values get updated (`setVal` / `setText` / `setHtml`). Never
  `innerHTML = ""` in a render path that runs on every selection — that was the scroll jump
  in the Build panel and the flicker in the Selection panel. `setVal()` leaves a focused
  field alone. `syncPressed()` sets pressed catalog buttons without touching the list.
- Prefetch: `applyBasemap("view")` fetches a full extent in every direction 500 ms after
  the last movement. The queue is pruned by **location** (outside this ring, or the wrong
  zoom level), not by generation — otherwise the prefetch would get evicted on the next pan
  before it finished loading. Tiles that arrive from cache in <120 ms don't fade in
  (`.instant`). The neighboring zoom levels z±1 are only **prewarmed** (`warmTile`, cache
  without an `<image>`), otherwise `dropStaleLevels()` would immediately clear the images
  again.
- `lv.tiles` and the DOM must stay in sync. Whoever drops a tile from the queue or loses
  its element must call `forgetTile()` — otherwise `applyBasemap()` considers it done,
  never requests it again, and a gray hole stays there.
- The ALKIS overlay is its own small pyramid (`ovLevels`), never `innerHTML = ""` per
  viewport — that was the flicker on zoom. And `dropStaleLevels(true)` only runs 600 ms
  after the queue is empty: `load` fires after the address is set, and cleaning up
  immediately released the old level too early.
- Tiles overlap: `tileRect()` gives `w`/`h` the `TILE_SEAM` allowance (`w/1024`, roughly
  half a screen pixel, because a tile per `zoomFor()` is always 512–1024 screen pixels
  wide). Without it the browser paints two `<image>`s at the same edge with half coverage,
  leaving a strip of `--ground` between them — that was the white/yellowish seams. Relative
  to the tile, not absolute: a fixed meter amount grows into a stripe when zooming in and
  doubles the translucent ALKIS lines, and `view`/`clientWidth` are 0 as long as dockview
  has the map panel detached. Likewise **both** pyramids need an emergency exit for cleanup
  (`dropStaleLevels(true)`, `dropStaleOv(true)` after 3 s): a tile that reports neither
  `load` nor `error` would otherwise hold the old level forever, with its lines offset
  against the new ones. That's also why `tileBlob()` has a deadline
  (`AbortSignal.timeout`).
- Tile blobs belong to the `<image>`: `memTiles` holds **blobs**, each tile creates its own
  `blob:` address and releases it again via `releaseTile()`. An LRU that releases someone
  else's address leaves empty tiles behind — and the coarser zoom level flashes through
  underneath.
  `inflight` counts requests (promises), not `load` events.
- Scale: `PX_PER_M = 5.957` is the sheet constant of the start box (`HOME`). Don't change
  it on your own authority — that shifts every length and cost.
- `GEO` maps pixels linearly onto EPSG:25832; from that, `applyBasemap()` builds the WMS
  bounding box for the **current** viewport. The layers compute with `GEO.pxPerM =
  150/25.4`, not with `PX_PER_M`. The origin `e0/n0` sits per plan in `state.geo`
  (`useGeo()` in `adopt()`), the default is Cologne Cathedral — **never a private location
  as a constant again**; `task check` verifies that. Changing the origin means
  `resetTiles()`. Positions are stored and shared as `e/n` (meters, EPSG:25832)
  (`stampGeo()` before every save/share/export, `unstampGeo()` in `adopt()`); `x/y` are
  only the pixel cache for that. `migrateLegacyGeo()` fixes up old states without `geo` via
  the house node's address — no origin in the code. `HOME` is now only the start box around
  the plan center, `⌂`'s target is the content.
- Assets inside the planner use absolute paths (`/favicon.svg`), because the page lives
  under `/planner`.
- `src/pages/planner.astro` builds to `dist/planner/index.html` and is served at `/planner`
  in `astro dev`, in `astro preview` and on a static host alike. Share links (`#p=…`) keep
  working because the path didn't change.
- Never hardcode text into markup or template strings: static text goes through
  `data-i18n`, dynamic text through `t("key")`, catalog text as `{ de, en }` via `tx()`.
  Every new key in **both** languages.
- An element's properties come from `SPECS[kind]`: fixed order, fixed rating (`ok` green
  `✓` = meets the spec, `warn` yellow `!` = a limitation). Color alone never carries the
  meaning.
- **Connections are derived, never stored.** `links()` reads conduits and bonds and
  returns status, source, distance and PoE load; the cache dies on every `renderMap()`.
  Whoever turns that into a state field ends up with two sources of truth. New displays
  read `links()`, they don't compute it themselves.
- **The hub and accessories are elements without a position.** `state.infra[id] = { on,
  qty }` stays the format — no `kind: "gear"` in `state.items`. Selection is `sel.kind ===
  "infra"`, deleting means `on: false`. Whoever assumes `sel.kind === "item"` must handle
  this case too.
- Conduit points with `at: "<itemId>"` attach to **any** element (junction, switch, hub,
  camera, AP) and get updated by `syncBonds()`. `x`/`y` stay maintained so that length,
  export and rendering never need to know about bonds.
- **A conduit is either a trench or a cable run, and every duct has its own type.**
  `c.kind === "trench"` means `ducts: [{ pipe: "dn50"|"dn63", cables: [{type,n}] }]` — 1–6
  ducts, each with its own price, plus excavation per meter. `c.kind === "cable"` is a
  cable run (wall, basement, attic, overhead line): **exactly one** bundle `ducts: [{
  cables: [...] }]` without `pipe`, without a trench, without excavation — several cables
  in it are explicitly allowed. `c.pipe` no longer exists, nor does `PIPES.none` or a flat
  `c.cables`. To find out what's inside, use `condCables(c)` (union, summed per type) and
  `condPipes(c)`/`pipeRate(c)` (ducts per type, empty for a cable run); costs, `links()`,
  names, export and the bill of materials all go through these exclusively. Only the
  drawing code and the panel know the individual ducts. `CONDUITS` are templates in the
  same shape, in two groups (`cat.trench` / `cat.cable`). `migrateConduit()` accepts all
  four historical shapes (`{type, cables:n}`, flat, one duct type per trench, current) —
  **this path must stay**, old share links carry the old shapes; `pipe: "none"` becomes
  `kind: "cable"` in the process.
- **A conduit isn't a line, it's layers on offset paths.** `drawConduit()` lays down the
  trench, one parallel per duct and one strand per cable **next to its duct's parallel** on
  the same path (`condLayout()` distributes the lanes); `path.core` is now only the hit
  area. The parallels come from `offsetPath(pts, d)` — `d` in **map units**, i.e. geometry,
  not a stroke width: the offset in px hangs off the node as `data-off`, `refreshOffsets()`
  (called from `refreshScale()`) recomputes it on zoom instead of redrawing. Never just
  crank up the width — that's exactly what made it unreadable.
- **Cross-sections are presentation, not state.** `g.csection` lives in its own group
  `#g-sections` (above the markers, below the handles), one circle per duct side by side
  along the route, no ring inside a ring. How many fit on a route is computed by
  `sectionOffsets()` from the zoom level (one in the middle, then every 220 px; 40 px
  clearance from ends and markers) — `refreshOffsets()` only redraws them when the
  **count** changes, same as `clusterLater()` does for clusters. Its own toggle
  `state.show.sections` → `hide-sections`, independent of `labels`. `refreshConduit()`
  must clean up `#g-sections` too.
- Drawing is **one** mode with two buttons: "Conduit" (L) uses `drawType` (the last chosen
  template, default `fiber`), "Cable" (C) sets it to `cable` — a cable run without a duct
  and without excavation. `toolOf(mode)` decides which button looks pressed based on the
  **kind of template**, not the cable inside it. If a fiber draft ends at a camera or an
  AP, `finishDraft()` switches it to Cat6A and says so — there's no SFP slot there.
- **The cluster marker has its own color token.** `--cluster` stays dark in both themes;
  `--ink` flips to light gray in dark mode, and the white number was no longer readable on
  it. Like `--cam`/`--ap`/`--jb` it lives in `src/styles/tokens.css` but only the planner
  uses it — and unlike the rest it is deliberately not redefined in the dark blocks.
- `jbAdvice()` suggests a switch with SFP instead of a converter plus switch at a fiber
  end (`#f-jb-advice`, like `hubAdvice()`). It only fires when **no single** device has
  both `sfp` and `poe > 0`, and only up to a `SWAP_SLACK` (€30) surcharge. **It changes
  nothing** — a recommendation, not an intervention.
- A junction is **one location**: `jb.model` is the housing (`shaft`, `box`, `cab`,
  `indoor` = no housing, €0), `jb.gear = [{model, n}]` are the devices inside it (switch,
  converter, splice box). Empty `gear` is a valid, purely logical point. `links()` only
  queries the aggregates (`jbPower`, `jbSfp`, `jbPoe`, `jbPorts`), never
  `JUNCTIONS[it.model]`. Old states run through `migrateJb()` in `adopt()` (a device as
  `model` → `indoor` + `gear`) — **this path must stay**.
- **The hover card is a node, not state.** `#hovercard` sits once in the document and gets
  filled by `showHover()`; it's triggered via `data-hover="<kind>:<key>"` on catalog cards,
  device and cable rows and select fields (`hoverSel()`, because an `<option>` natively has
  no hover). It only shows the short version — image, name, price, `optHint()` and two
  sentences. The full data sheet stays in the ⓘ dialog (`showProductInfo`); the ⓘ button on
  a catalog card is that card's **sibling** (`catCard()`), never a button inside a button,
  and adds nothing. None of it belongs in `state`.
- **The selection panel stays lean.** It only holds input fields, lists (devices, conduits,
  devices attached) and the connection status. Every data sheet — properties, unit price,
  "Good fit/Less suited", body text, `productBox()` — goes through `showProductInfo(kind,
  key)` into `#infoDlg`. No preview box in the panel, or you'd scroll past the controls.
  The ⓘ sits in the action column: row `[Name] [Qty] [ⓘ] [🗑]`, the add-row
  `[Select] [ⓘ] [+]`, a select field `[Select] [ⓘ]` — never as a superscript on the text.
- The **hub** (`hub`) is no longer a do-everything device: the router comes from `INFRA`
  (`role: "router"`, with `ports`/`sfp`/`poe`; `sfp` means usable **on the LAN side** — on
  every FRITZ!Box the SFP slot is the WAN port, so `false`), the devices live in `hub.gear`
  just like at a junction. One router per plan (`pickRouter()`). `isCopperSource(hub)` =
  `hubPower()`, `takesFiber(hub)` = `hubSfp()` — without an SFP slot no fiber arrives there,
  without a PoE output no camera.
- **Connected is not powered.** `links()` checks in two stages: first "what am I connected
  to" (`reach()` returns the reached points via `seen`), then "does that supply anything".
  Hence `link.dead` / `link.deadup` instead of "No cable reaches here" whenever a cable ends
  at an empty or disconnected point. `link.none` stays reserved for the case where there's
  no cable at all.
- **Conduit names are automatic until someone types.** Empty, a template name from
  `CONDUITS`, or exactly what `condName(c)` produces → the name follows along on every
  change to duct or cables. Every such mutation goes through `condEdit(c, mutate)` (checks
  **before** the change), `adopt()` migrates old plans once. Otherwise "DN 50 + Fiber"
  would sit over a trench with no duct and Cat6A instead.
- **Fiber is not split at a junction.** Two destinations means two cables in the trunk
  duct, which just get carried onward there. A branch with no cable of its own (`cables:
  []`) is therefore correct, not a bug. Splitting costs a splice box, copper at the fiber
  end costs a switch or media converter (`power: true`).
- Presentation runs through factors and CSS variables, **never** through `renderMap()`:
  `state.look` sets `size` (a factor in `calcScale()`) as well as `--look-font`,
  `--look-alpha` and `--look-line` on `svg.map` — these travel with the clone into image
  export and PDF. Only `look.cluster` triggers a redraw. `look` doesn't belong in
  `HIST_KEYS`.
- **Power at a point is checked, never assumed.** `powerIn: "mains"|"poe"|"none"` sits on
  **every** device in `JUNCTIONS` (`task check` enforces it, housings carry none) and says
  where it draws power from; `power` remains "active device" — a PoE-fed switch is `power:
  true, powerIn: "poe"`. `links()` reports `link.mains` when a `mains` device sits at a
  location with no outlet (`mainsAt()`: hub, `indoor`, `rack19`, or a conduit with NYY-J) —
  **one** status per point. A `poe` device loads the budget of its upstream source (default
  15 W) via `jbDraw()`, same as a camera.
- Housing and device are separated by `kind: "housing" | "device"` in `JUNCTIONS`, never by
  `power`: a splice box, surge protector, SFP module and PoE extender need no power and are
  still devices. SFP slots sit as `sfpPorts` on a device, outputs as `poePorts` (injector),
  range extension as `extend` (PoE extender).
- Undo/redo works with JSON snapshots via `HIST_KEYS`. Every mutation goes through
  `changed()`, which calls `histPush()` — mutating around it means it can't be undone.
- No tabs: the sidebar is a stack of collapsible, drag-sortable panels (`PANELS`,
  `buildPanels()`, panes are still named `#pane-<id>`). No docking framework — that would
  be a dependency. Selection changes nothing, it only fills `#pane-sel`.
- Everything that makes up the working state belongs in `state` — only then does it survive
  a reload (localStorage) and travel in the share link. That includes UI odds and ends like
  search text, filters, panel layout, viewport.
- `basemapLater()` only saves once `booted` is set. Otherwise a slow load would overwrite
  the plan with the default.
- `amazon:` in the catalog is a verified `https://www.amazon.de/dp/<ASIN>` (as of 09/2026,
  `task check` verifies the shape). `amazonSimilar: true` means a substitute item instead
  of the original and only changes the link title. Verify new ASINs, don't guess.
- Product links: `url` in the catalog is the verified path under
  `eu.store.ui.com/eu/en/category/`; third-party manufacturers (`vendor:
  "reolink"|"netatmo"`) carry an absolute address. Without `vendor`, UniFi applies. The
  manufacturer filters in the camera tab (`v-ui`, `v-reo`, `v-net`) hang off `vendorOf()`.
  Verify new models with `curl -o /dev/null -w '%{http_code}'`, don't guess.
- Change prices only in the catalogs (`CAMS`, `APS`, `CONDUITS`, `INFRA`) and keep the
  as-of note in the cost tab (`as of 09/2026`) in sync.
- Plans live individually under `sl-plan:<id>`, the list under `sl-plans`, the active one
  under `sl-current`. Never write a global `sl-plan` key again — that's exactly what
  overwrote the previous plan on a fresh start. `migrateLegacy()` lifts old states over.
- **Every browser key starts with `sl-`.** They used to start with `oh-`.
  `migrateKeys()` runs as the first line of `boot()`, before any read: copy each `oh-*`
  key to `sl-*` where that name is free, drop the old one, delete the `oh-wms-v1` tile
  cache. Idempotent — it may run on every boot. The website needs the same few lines
  inline in `src/components/LangToggle.astro` and `src/pages/index.astro`: a file under
  `public/` has no build step, so Astro cannot import it. Keep the three copies in step
  until one shared module replaces them.
- Language: the planner and the website share `localStorage["sl-lang"]`. The planner
  writes it in `setLang()` and `adopt()`, the website via
  `src/components/LangToggle.astro`. New pages must include that component, otherwise the
  page falls back to German.
- **`defaultState()` starts empty.** No elements, no conduits, nothing preselected in
  infrastructure. The planner is meant for general use and must never show someone else's
  property as an example. `task check` fails as soon as content or place names land in it
  again.
- Nothing location-specific in `public/` or `src/` — no addresses, no cadastral extracts,
  no sample plans.
- Persistence runs without a server: localStorage, share link, JSON export. The
  `claude.use("db")` branch is optional and must never block — without it `db` stays `null`.
- Maintain both themes (light/dark): colors only through the CSS tokens in
  `src/styles/tokens.css`. They live there **once**; `src/layouts/Base.astro` only maps them
  onto Pico's `--pico-*`, and `src/styles/planner.css` only consumes them.
- PDF: printing runs through `@media print` and `printSheet()`; the direct download uses
  jsPDF (from npm, loaded on demand, added on explicit request). Both consume
  `sheetData()` — maintain the content once. No jsPDF extensions (autotable etc.) without
  discussion.
- Mobile (~400 px) must stay usable: map on top, panel below.

## Testing

Automated: `ocx exec -- task lint`, `task test`, `task test:e2e`, `task check`. Manual
smoke test before every commit:

1. `ocx exec -- task serve`, open the page, check the console for errors
2. place a camera / draw a conduit / check the cost tab once
3. `ocx exec -- task check` — astro check, oxlint, vitest, Playwright (it starts its own
   dev server), then the repo assertions in `tools/check.mjs`
4. `ocx exec -- task build` must complete

Playwright boots the real page; `tools/check.mjs` only reads files. Whoever makes a larger
change to the planner adds a spec under `tests/e2e/` instead of relying on a visual check.
`PW_BASE_URL=http://localhost:4400 pnpm exec playwright test` runs the same suite against an
already-running server — that's how the production bundle gets checked after `astro preview`.

Playwright is a devDependency (Chromium: `ocx exec -- npx playwright install chromium`).
`tools/shot.mjs <folder>` opens the planner, expands the export dialog and drops
`export.png` / `export-dlg.png` — for layout questions, **look first, then guess**; the
script can be adapted for other dialogs.
