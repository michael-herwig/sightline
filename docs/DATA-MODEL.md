# Data model and cost logic

Everything lives in `public/planner/index.html`, in the `<script>` section. No dependencies, vanilla JS, SVG overlay over `plan.png`.

## Constants

```js
PX_PER_M = 5.957      // cadastral extract 1:1000 at 150 dpi
W = 1302, H = 1011    // size of plan.png = SVG viewBox
S = 1.50817, OX = 452, OY = 497
R(x, y)               // converts sketch coordinates (1163 px wide preview of the whole sheet) into plan.png pixels
```

`R()` is only needed for the default plan. New elements are created directly in plan.png pixels.

## State

```js
{
  items: [
    // x/y = plan pixels (cache), e/n = EPSG:25832 in metres (source of truth; stampGeo() on save, unstampGeo() in adopt())
    // gear = switch/converter at the head end; the router lives in infra, not here.
    { id, kind: "hub",  label: "H",  x, y, e, n, note, wan: { type: "dsl"|"fiber", speed }, gear: [{ model: "usw-ultra-60w", n: 1 }] },
    { id, kind: "cam",  label: "K1", x, y, rot, model: "g6-bullet", note },   // rot in degrees, 0 = east, 90 = south
    { id, kind: "ap",   label: "A1", x, y, model: "u7-pro", note, rings?: "both"|"far"|"near"|"none", place?: "in"|"out" },   // rings; placement (indoors halves it)
    // model = housing/location, gear = the devices inside it. Empty gear = a purely logical point.
    { id, kind: "jb",   label: "J1", x, y, model: "shaft"|"box"|"cab"|"indoor", gear: [{ model: "flex", n: 1 }], note },
  ],
  conduits: [
    // Two kinds. `trench` = a trench: 1–6 pipes inside it, **each with its own type and its own price**,
    // and each pipe with its cables. `cable` = a cable run (wall, cellar, loft, overhead line):
    // exactly one bundle without a pipe, but with any number of cables inside it.
    { id, kind: "trench", ducts: [{ pipe: "dn50"|"dn63", cables: [{ type: "fiber"|"cat"|"power", n: 2 }] }, …],
      label, points: [{x, y, e, n, at?: "<itemId>"}, ...] },
    { id, kind: "cable",  ducts: [{ cables: [{ type: "cat", n: 2 }] }], label, points: [...] }
  ],
  infra: { ucg: { on: true, qty: 1 }, flex: { on: true, qty: 3 }, ... },   // key = INFRA[].id
  name: "",             // project name, empty = falls back to a localized "untitled plan"
                        // defaultState() returns items: [] and conduits: [] — the planner starts empty
  catTab: "cam",        // active catalogue tab
  catQuery: { cam: "", ap: "", jb: "", gear: "", cond: "" },   // search text per tab (old: a single string)
  // What the map shows — five toggles behind the eye under the zoom (SHOW_KEYS).
  show: { cones: true, rings: true, conds: true, labels: true, sections: true },
  budget: 3000,
  earthwork: 0,         // €/m of trench, 0 = DIY labour
  seq: 8                // counter for uid()
}
```

House nodes (`hub`) can be placed, moved and deleted; their `wan` holds the connection type and tier
(DSL 10/15/25/50, fibre 100/200/400/600/1000 Mbit/s). `sane()` only checks on load that the
models exist in the catalogue and every conduit has at least two points; `adopt()` merges a
loaded state over the default and runs every conduit through `migrateConduit()`. That function knows
four past shapes and turns all of them into a kind and a pipe list — share links carry the old
shapes, **this path must stay**:

| Shape | Form | becomes |
|---|---|---|
| oldest | `{ type: "fiber", cables: 2 }` | template from `CONDUITS[type]`, one pipe |
| flat | `{ pipe, ducts: <number>, cables: [{type,n}] }` | `<number>` pipes, **each** of type `pipe`, all cables in pipe 1 |
| one pipe type per trench | `{ pipe, ducts: [{ cables: […] }] }` | every pipe inherits `pipe` |
| current | `{ kind, ducts: [{ pipe, cables: […] }] }` | normalized (max. 6 pipes, quantities 1–12) |

`c.pipe` **is gone**; the pipe type now lives on the pipe. The old pipe type `pipe: "none"` is no
longer a pipe kind, but its own kind `kind: "cable"`: a cable run always has **exactly one** bundle
without a `pipe`, everything pulled lies together. If `kind` is missing but the pipes carry a type,
it's a `trench`. The same call runs in the panel when the kind is switched — switching to a cable
run drops all cables into one bundle, switching back to a trench wraps a `dn50` around it.

`state.dock` holds the dockview layout, `state.dockSize` the group size last seen, per panel.
If a panel is dragged into a **new** group, it gets that size back instead of a 50/50 split;
if it lands in an existing group, the layout stays untouched.

## Catalogues

- `CAMS[model]` → `{ name, price, res, ir (m), fov (°; 360 = PTZ, circular), poe, ip, out, note, tags, wifi?, vendor?, zoom? }`
  `out: true|false` is set explicitly, not guessed from `ip` — it drives the `mount` spec row,
  the `camout`/`camin` filters and the search words "außen/aussen/outdoor" resp. "innen/indoor"
  (both languages, so "outdoor" also matches in the German UI).
  `vendor` is absent for UniFi, otherwise `reolink` / `netatmo`; then `url` is absolute instead of a store path.
  On the map a circular sector is drawn with radius `ir * PX_PER_M` and opening `fov` around `rot`.
  Models whose `res` contains "4K" count as 4K for the NVR warning.
- `APS[model]` → `{ name, price, note, radius (m, rough free-field range), out }`
- `JUNCTIONS[model]` → `{ name, price, ip, ports, mount, note, power?, sfp?, poe?, url? }` – **one** map
  for two roles. `isHousing(key)` = passive and not `splice` → a housing or location (shaft, gel-filled
  box, cabinet, `indoor` = no housing, 0 €). `isDevice(key)` = everything else → a device that gets
  dropped into a point (switches, media converters, splice box).
  `power: true` means: needs mains power. That's why switches sit on the map instead of as a row in `INFRA`.
  Only entries with `power` carry `sfp: true|false` (fibre plugs straight in) and `poe: <W>`
  (PoE budget, `0` = supplies no power). Both rows in `SPECS.jb` are gated by `when: m => !!m.power`.
- `PIPES[pipe]` → `{ name, m (€/m) }`
- `CABLES[type]` → `{ name, m (€/m), fixed (€ per cable, e.g. an SFP pair), color, note, max? (m) }`
- `CONDUITS[key]` → template for the catalogue button: `{ name, kind, ducts: [{ pipe?, cables: [{type, n}] }] }`.
  The catalogue tab shows them in two groups (`cat.trench` / `cat.cable`); `cable` and `cable-fiber`
  are the cable runs, "Cable" (C) picks `cable`.
- `condDucts(c)` / `ductCables(d)` / `condCables(c)` — **every reader goes through here.** `condCables()`
  is the union over all pipes, once per cable type with summed quantity, sorted by
  `CABLE_ORDER` (`fiber → cat → power`). Costs, `links()`, naming, export and the bill of materials all
  query it; only the drawing and the panel know the individual pipes.
- `isCableRun(c)` / `condPipes(c)` / `pipeRate(c)` — the same role for the pipe side. `condPipes()`
  counts the pipes per type (in the order of `PIPES`) and returns the empty list for a cable run;
  `pipeRate()` is the resulting sum in €/m. Costs, the pipe row in the panel, the preview and the name
  all go through it.
- `WAN[type]` → `{ name, speeds: [Mbit/s] }` – the connection at the house node
- `WHEN["<kind>:<key>"]` → `{ de: { yes, no }, en: { yes, no } }` – when the model fits and
  when it doesn't. Deliberately kept next to the catalogues so the data sheets stay readable.
- `img:` in a catalogue entry is the image URL at the manufacturer (`tools/fetch-images.mjs`)
- `INFRA[]` → `{ id, name, sub, note, price, qty, on, vendor?, url?, hidden? }` – head end and accessories.
  Its own catalogue tab `gear` in the Build panel; `hidden: true` stays out of it (switches sit
  as elements on the map). No placement mode: a click sets
  `state.infra[id] = { on: true, qty: <previous> + 1 }` and selects the item.

Maintaining prices: only change the catalogues. Figures as of: 09/2026, UniFi EU Store / Geizhals, typical figures for pipe/cable.

## Cost formula

Conduit: `len = polyline length / PX_PER_M`

```
pipe  = len × Σ PIPES[d.pipe].m          (per pipe individually; cable run: 0)
cable = Σ len × CABLES[e.type].m × e.n
fixed = Σ CABLES[e.type].fixed × e.n
earth = len × state.earthwork            (only `kind: "trench"`; cable run: 0)
total = pipe + cable + fixed + earth
```

A cable run therefore costs **only the cable**: no pipe, no earthwork. A trench costs the earthwork
once per metre, plus every pipe at its own type's rate — a DN 63 for power next to a DN 50 for data
in the same trench is the normal case.

An empty cable list means: only a pipe lies here. That's the normal case for a branch whose fibre
is already counted in the trunk pipe — **fibre is not split at a junction**, it runs through uncut.
Two destinations = two cables in the trunk pipe. Anyone who really has to split it uses a splice box
(`JUNCTIONS.splice`, passive, no power); anyone who needs copper at the fibre end uses a switch or
media converter (`power: true`).

Total = Σ cameras + Σ APs + Σ junctions/gear + Σ conduits + Σ (INFRA on × qty × price).

## Persistence

- `localStorage["sl-plan:<id>"]` per plan, on every change (debounced 900 ms)
- `localStorage["sl-plans"]` – list `[{ id, name, updated, n }]`, newest first
- `localStorage["sl-current"]` – the last plan opened
- `localStorage["sl-lang"]` – language, shared with the website
- `caches["sl-wms-v1"]` – WMS tiles, 30-day lifetime
- All of these used to start with `oh-`. `migrateKeys()` renames them once at the start of
  `boot()` (copy where the new name is free, drop the old one, delete the `oh-wms-v1`
  cache) and is safe to run again.
- In the claude.ai Artifact version, additionally `claude.use("db")` → document `plan/current`; in
  the standalone build `window.claude` doesn't resolve and that branch is skipped
- Export/import as JSON in the **Elements** tab (standalone)

## Interaction

- `mode`: `select | place-cam | place-ap | draw`
- Pointer events on `#mapwrap`: pan in select mode, drag for markers and conduit points (`startDrag`),
  clicking in place/draw mode places elements or points
- Zoom via `viewBox` (`zoomAt`), coordinates via `getScreenCTM().inverse()`
- Rendering is entirely state-driven: `renderMap()` rebuilds the SVG groups every time,
  `renderSide()` the three panels. `changed()` = both + save.


## Additions (09/2026)

### New state fields

| Field | Meaning |
|---|---|
| `lang` | `"de"` \| `"en"`, drives `t()` and `tx()` |
| `sideW` | width of the sidebar in px, 280 … 760 |
| `basemap` | `"dop"` \| `"alkis"` (WMS Geobasis NRW) |
| `overlay` | cadastral map semi-transparent over the aerial imagery |
| `view` | `{x,y,w,h}` of the viewport in plan pixels, survives a reload |
| `panels` | `[{id, open}]` — order and collapsed state of the sidebar |
| `catQuery`, `catFacets` | search text per tab (`cam`, `ap`, `jb`, `gear`, `cond`) and active filter badges |
| `show` | `{cones, rings, conds, labels, sections}` — the five toggles behind the eye; a missing key counts as on (`sh[k] !== false`) |
| `look` | appearance (gear icon under the eye), see below |

### Appearance (`state.look`)

```js
look: { size: 1, font: 1, alpha: 1, line: 1, cluster: true }
```

| Field | Range | Effect |
|---|---|---|
| `size` | 0.6 … 1.6 | factor in `calcScale()` — markers, groups, handles, status rings, cross-section badges |
| `font` | 0.7 … 1.5 | CSS variable `--look-font`: marker, group, cross-section and conduit labels |
| `alpha` | 0 … 1 | CSS variable `--look-alpha`: opacity of `#g-cover` (fields of view, AP rings, IR areas) |
| `line` | 0.6 … 1.6 | CSS variable `--look-line`: stroke widths of the conduit layers and the spacing of their lanes |
| `cluster` | `true`/`false` | off ⇒ `buildClusters()` returns `[]`, every marker stands on its own |

The three variables hang off `svg.map` and get cloned along by `renderPng()` — whatever the
map shows, image export and PDF show too. `applyLook()` clamps every value to its range,
writes it back to `state.look` and re-runs `refreshScale()` and `refreshOffsets()`;
only the group toggle triggers a redraw. `adopt()` fills in anything missing from `defaultState()`.
`look` is **not** in `HIST_KEYS`: a slider isn't a work step.

### Junction points

An item with `kind: "jb"` is **a place**: `model` is the housing (`shaft`, `box`, `cab`,
`indoor`), `gear: [{ model, n }]` are the devices inside it. Empty `gear` is a purely logical
point — cables just meet there, and that's not an error.

| Aggregate | Rule |
|---|---|
| `jbPrice(it)` | price of the housing + Σ `price · n` of the devices |
| `jbPower(it)` | any device with `power` |
| `jbSfp(it)` | any device with `sfp` |
| `jbPoe(it)` | Σ `poe · n` across all devices |
| `jbPorts(it)` | Σ `gearPorts · n` of the **switches** (`gearPorts > 1`), if one is present — otherwise Σ of the converters. A converter ahead of a switch adds no downstream port, its port feeds in internally |
| `sfpPorts(it)` | Σ `sfpPorts · n` — the count sits on the device, not derived from the port count. Without one given: `sfp ? 1 : 0` |
| `jbExtend(it)` | Σ `extend · n` — a PoE extender raises the copper limit of the run it sits on |
| `jbMains(it)` | the first device with `powerIn: "mains"` — the need for an outlet on site |
| `jbDraw(it)` | Σ `poeDraw · n` of the devices with `powerIn: "poe"` (15 W if not given) — load on the feeder ahead of it |

`powerIn` on the catalogue entry says **where** a device gets its power from: `"mains"` (its own
adapter), `"poe"` (from the network cable) or `"none"` (splice box, SFP module, surge
protector). `power` is unaffected by that and still means "active device" — a PoE-powered
switch is both (`power: true, powerIn: "poe"`). Housings carry no `powerIn`; `task check`
verifies both.

`gearPorts(m)` is `m.poePorts ?? m.ports`: a PoE injector has two jacks, but only one of them
carries on downstream. Housing and device are told apart by `kind: "housing" | "device"` on the
catalogue entry — **never** by `power`: a splice box, surge protector, SFP module and PoE extender
need no power and are still devices.

`links()` only reads these aggregates, never `JUNCTIONS[it.model]` directly. A point without
devices is passive: cables run through, fibre may end there (`takesFiber`), but copper gets no
source there (`isCopperSource`).

**Migration** (`migrateJb()` in `adopt()`, this path must stay): an old point whose
`model` was a device (switch, converter, splice box) becomes `{ model: "indoor", gear: [{ model: old, n: 1 }] }`.
`indoor` costs 0 €, so the total stays unchanged. A point without `gear` gets `gear: []`.

Points cost money and appear as their own group in the list, the bill of materials and the totals
(`costs().jbs`, `sumJbs` = housing **and** devices). The bill of materials lists housings per model,
with the devices bundled underneath across all points (`jbGearGroups()`).

### Recommendation at the point

`jbAdvice(it)` shows as a `.tip` under the device list of a junction point (`#f-jb-advice`), like
`hubAdvice()` at the head end. It only speaks up when fibre arrives there and **no single**
device has both `sfp` and `poe > 0` at once — a media converter plus a switch without SFP together
meet both and are exactly the case meant here. It recommends the cheapest `JUNCTIONS` entry with
`sfp && poe > 0 && poe >= watts && ports >= used` (the need coming from `links().gear`), and only as
long as its price is at most `SWAP_SLACK` (30 €) above what's already there. **Nothing gets
changed** — the sentence is only a hint.

If the point lacks mains power (`link.mains`), a second recommendation takes its place: the
cheapest device with `powerIn: "poe"` that can do the same (SFP, if fibre arrives there; PoE, if
PoE is already being handed out there) and costs at most `SWAP_SLACK` more. Feeder devices
(injector, extender) are left out — they don't replace a switch.

### Conduit names

`c.label` is **automatic** as long as it is empty, matches a template name from `CONDUITS`
(both languages, `TEMPLATE_NAMES`), or matches exactly what `condName(c)` currently generates.
Every change to kind, pipe, pipe count or cables goes through `condEdit(c, mutate)`: it checks
**before** the mutation whether the name was automatic, and rewrites it afterwards. A name typed
by hand stays put. `adopt()` migrates old plans once, `finishDraft()` builds the name straight from
kind, pipes and cables instead of from the template name — otherwise "DN 50 + fibre" would sit over
a cable run with Cat6A.

For a trench, `condName(c)` names the pipes grouped by type and then the cables
("2 × conduit DN 50 + 1 × conduit DN 63 + 1 × single-mode fibre, 4 fibres + 2 × Cat6A"; with exactly
one pipe the leading count is dropped), and for a cable run "2 × Cat6A (no pipe)" (`cond.cableName`, de/en).

### Drawing conduits

Pure rendering — nothing changes in the model. `drawConduit(c)` lays **three layers on
the same path**, all widths in screen points (`strokePx`, `vector-effect: non-scaling-stroke`):

| Layer | when | appearance |
|---|---|---|
| `path.halo` | always | white backing, trench width + 4 px with a pipe, otherwise 6 px; selected `--sel` |
| `path.trench` | `kind === "trench"` | `--ink` at 12%, `6 + Σ pipe lanes` px |
| `path.duct` | `kind === "trench"` | one parallel per pipe, `--ink-3` at 55%; dashed without cables |
| `path.strand` | per cable | `CABLES[type].color`, 2 px, copper dashed, **next to its pipe's parallel** |
| `path.core` | always | invisible hit area, carries the click |

`condLayout(c)` distributes the width: every pipe gets a lane of `max(3, (m−1)·2 + 3)` px for
its `m` visible strands, the lanes sit side by side and the whole set is centred on the path.
More than eight strands are not drawn — those show up in the cross-section instead. Every strand
carries its pipe as `data-duct`.

The parallels are built in `offsetPath(points, d)` (mitred at kinks, mitre limit 4, otherwise
bevelled). `d` is in **map units**, so it's geometry, not a stroke: the offset in
screen points hangs off the node as `data-off`, and `refreshOffsets()` (called from `refreshScale()`)
recomputes it while zooming — nothing gets redrawn in the process.

### Cross-sections

`drawSections(c, pts)` places **cross-sections** along the route: `g.csection[data-id]` in its
own group `#g-sections` (above the markers, below the handles), rotated like the length
label and shifted 17 px to its other side. Inside sits **one circle per pipe**,
side by side along the route and touching; the cables of that pipe sit as coloured dots
inside it, and above eight cables per pipe the count is shown instead. No ring inside a ring. For a
cable run, only the dots remain. Clicking a cross-section selects the conduit.

`sectionOffsets(c, pts, k)` decides where they sit: one at the centre, then one every
`SECTION_STEP` (220) screen points to the left and right — a comb around the centre. The first and
last `SECTION_EDGE` (40) px stay free, and 40 px around every bound waypoint, since a marker sits
there. Below 40 px of route length there is none at all. **This hangs off the zoom, not the
state:** `refreshOffsets()` compares the desired count with the existing one and only redraws on a
difference — like `clusterLater()` does for the groups. `refreshConduit()` has to clean up
`#g-sections` too.

Its own toggle in the eye menu: `state.show.sections` (default on) sets `hide-sections` on
`svg.map`, **independent** of `labels`. Both classes carry over into export and print.

### Bonds

A conduit point may carry `at: "<itemId>"`. `syncBonds()` runs at the start of every
`renderMap()` and copies `x`/`y` from the element; if `at` points nowhere, it's dropped.
While dragging a point, `snapTarget()` decides within a 16-screen-px radius whether to rebind
or release it. Everything else (length, costs, export, import) keeps computing only
from `x`/`y`.

### Selection

`sel` is `{ kind: "item" | "conduit" | "infra", id }`. `infra` is an item from `INFRA` and has
no position: `centerOn()` bails out for it, `deleteSelected()` sets `on: false` instead of deleting,
`duplicate()` doesn't exist for it. The panel is built by `buildGearSel()` with the signature `gear:<id>:<lang>`.

### Connections (derived, never stored)

`links()` computes the topology from the plan and caches it until the next `renderMap()`
(which sets `LINKS = null`). **None of it lives in the state** — conduits and bonds are the source of truth.

| Step | What happens |
|---|---|
| `poeWatts(m)` | from `tx(m.poe)`: `802.3bt` → 60 W, `802.3at` → 30 W, `802.3af` → 15.4 W, otherwise 0 |
| `linkEdges()` | one edge per conduit and cable type between two bound points; the length is the distance **along the route**, not the whole conduit length |
| `reach(id, type, isSource)` | PoE feed per camera/AP: Dijkstra to the first source, along the way only a `jb` without a powered device passes it on. The source for `cat` is `hub` or any `jb` with `jbPower` |
| `reachHub(id)` | uplink per active `jb`: Dijkstra to the `hub`, **also through other active devices**. The state is `(node, incoming cable)`, not the node alone: the cable type is preserved, and it only switches over at a point with `jbPower && jbSfp`. A fibre edge additionally needs something at both ends that accepts it (`hub`, a passive `jb`, `jbPower && jbSfp`) |

Two switches hanging only off each other therefore have no uplink; fibre that ends in a
shaft and continues as copper behind it doesn't either. `first` is the cable type arriving at the
device itself, `maxCat` the longest **unbroken** copper run — the 90 m limit applies per
run, not per path.

Result: `{ status, src, gear, touch }`.

- `status` per element `{ g: "ok"|"warn"|"err", key, vars, more? }`. `key` is a `link.*` key;
  `more` carries further findings when several apply at once (too long **and** no PoE source).
  Every display goes through `linkText()`, none reads `key`/`vars` itself.
- `src` the PoE feed per camera/AP — and per active `jb`, **when its uplink arrives over copper**.
  That way a switch on another switch's copper counts there as a connected device
  (0 W), and its own port for the uplink counts against it.
- `gear` per active `jb` and per `hub`: `devices`, `watts`, `used` (ports in use), `over`, `portsOver`.
  `poe` and `ports` come from `jbPoe()` / `jbPorts()`, i.e. from the devices at the point — for the `hub`
  from `hubPoe()` / `hubPorts()`, i.e. router **plus** devices.
  Fibre occupies no RJ45 port; a cable between two switches counts exactly once at each end.
- `touch` the conduits per element.

### Head end (`hub`): router and devices

The house connection used to be a jack-of-all-trades — a copper *and* fibre source, PoE "not
checked". Now it holds what you actually install:

- **Router**: an entry from `INFRA` with `role: "router"`, plus `ports` (LAN RJ45), `sfp`
  (usable **on the LAN side**, not the WAN port) and `poe` (PoE output in W).
  `ucg`: 4 ports, `sfp: true` (one SFP+ can be switched to LAN), `poe: 30`.
  FRITZ!Box: `sfp: false` (there the SFP cage is WAN), `poe: 0`; `fb7690` 4, `fb5690`/`fb5590` 5,
  `fb5530` 3, `fb6690` 4 ports. **One router per plan** — `pickRouter()` switches off the others.
- **Devices**: `hub.gear` just like for `jb`, the same `JUNCTIONS` entries and the same helpers.

| Aggregate | Result |
|---|---|
| `hubRouter()` | the first `INFRA` entry planned with `role: "router"`, otherwise `null` |
| `hubPower(it)` | a router present **or** a powered device in `hub.gear` → a copper source |
| `hubSfp(it)` | a router with `sfp` **or** a device with `sfp` → accepts fibre |
| `hubPoe(it)` | router `poe` + Σ `poe` of the devices |
| `hubPorts(it)` | router `ports` + `jbPorts()` of the devices |
| `hubSfpPorts(it)` | 1 for a router with `sfp` (only one SFP+ becomes LAN) + `sfpPorts()` of the devices |

`isCopperSource(hub)` is therefore `hubPower()`, `takesFiber(hub)` is `hubSfp()` — a fibre edge
into the head end is only usable if an SFP cage sits there. Migration in `adopt()`: a `hub`
without `gear` gets `gear: []`. Costs: the head end's devices go through `gearPrice()` into
`costs().hubs` and show up in the bill of materials, the print sheet and the Markdown export under
*Junctions/gear*.

### Two-stage check

A device can be cabled **and** unsupplied. That's why `links()` first asks "what am I
connected to" and only then "does that supply anything":

| Finding | when |
|---|---|
| `link.none` | no Cat6A conduit at the device at all |
| `link.fiber` | fibre ends directly at the device |
| `link.dead` | a cable reaches points, but none of them is a source (`{pt}` = the point reached) |
| `link.deadup` | a source was found, but it itself has no uplink to the head end |
| `link.nopoe` | the source supplies 0 W of PoE (only a converter, or a head end with no PoE output) |
| `link.long` | past `CABLES.cat.max` in one unbroken run |
| `link.norouter` | head end without a router |
| `link.hub.ok` | head end with a router: `{router} · {n} devices` |
| `link.bal` | passive point: more cables of one type end here than there are counterparts |
| `link.sfpcount` | more arriving fibre cables than SFP cages at the point (`fiberEnds()`) |
| `link.mains` | a device with `powerIn: "mains"` sits at a place with no outlet (`{pt}`, `{gear}`) |

**Power at the point** (`mainsAt(it, touch)`): it's covered at the head end, in the `indoor`
and `rack19` housings, or when a conduit with a `power` cable (NYY-J) ends at the point. Otherwise
the point reports `link.mains` — **one** finding per point, not per device, sitting in `more` next
to the uplink finding. A device with `powerIn: "poe"` doesn't trigger it: it hangs off the copper
uplink and loads its feeder's PoE budget via `jbDraw()` just like a camera. A **fibre source** is
any device with several SFP cages: the arriving fibre ends there, further fibres branch off
(`reachHub()` switches over at a point with `jbPower && jbSfp`), and only the **count** is checked
against `sfpPorts`.

`fiberEnds(id)` only counts the fibre cables that actually land in an SFP cage here: a cable
whose other end doesn't accept fibre at all (camera, AP) is that **other device's** finding
(`link.fiber`) and occupies no cage here.

`cableEnds(id, type)` counts the cable ends per point: a conduit passing through contributes two
(in and out) and balances itself, a conduit ending here contributes exactly one. `unbalanced()`
weighs the largest bundle against the sum of the rest. If a **splice box** sits at the point, the
balance check is dropped — splitting is allowed there. Power (`NYY-J`) is never balanced.

An extra finding in `more` raises `g` to at least `warn`: an "ok" with a warning would otherwise stay silent.

Cameras and APs with `poeWatts === 0` (Wi-Fi, own power adapter) get no finding.
This gets read by `drawMarker()` (ring `circle.alert`), `linkHtml()` (selection panel, `#f-link`),
`renderList()` (the `.st` dot), `renderCost()` (`#c-warn`), `planMarkdown()` and `sheetData()`.

### Georeferencing

`GEO = { e0, n0, pxPerM: 150/25.4 }` maps plan pixels linearly onto
EPSG:25832 (`px2e`, `px2n`). `applyBasemap()` builds the BBOX for the *current*
viewport from it and fetches the WMS tile at screen resolution; `HOME` is the property.
`e0`/`n0` come from `state.geo` (per plan; `adopt()` calls `useGeo()`), with `GEO_DEFAULT` = Cologne
Cathedral at the plan's centre as the default. `seedFromPlace()` sets a new plan's origin to the
searched address (`geoAround`). An origin change calls `resetTiles()`, because the tile rectangles
hang off the origin.
**Not** the same as `PX_PER_M` — see the README, section Scale.
