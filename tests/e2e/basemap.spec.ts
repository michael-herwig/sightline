import { expect, test } from "@playwright/test";
import { smallPlan } from "./fixtures";
import { openPlanner, stubOffsite } from "./helpers";

// Tiles on a fixed grid, seams via an allowance in the tile width, ALKIS as its own
// small pyramid. Checked via DOM attributes, not pixels.
// Source: tools/check.mjs, first jsdom boot.

test.beforeEach(async ({ context, page }) => {
  await stubOffsite(context);
  await openPlanner(page, { plan: smallPlan });
  // The stock (applyBasemap("view")) lays the ring around the viewport 500 ms after the
  // last movement — only then are there neighboring tiles on which the seam is measurable.
  await expect
    .poll(async () => page.locator("#g-tiles image").count(), { timeout: 15_000 })
    .toBeGreaterThan(1);
});

const tileUrls = (page: import("@playwright/test").Page) =>
  page
    .locator("#g-tiles image")
    .evaluateAll((n) => n.map((i) => i.getAttribute("data-url") ?? i.getAttribute("href") ?? ""));

test("tiles sit on one zoom level and snap to the grid", async ({ page }) => {
  await expect(page.locator("#g-tiles g[data-z]").first()).toBeAttached();
  const urls = await tileUrls(page);
  expect(urls.length).toBeGreaterThan(0);
  for (const u of urls) {
    expect(u).toMatch(/wms_nw_dop/);
    expect(u).toContain("CRS=EPSG:25832");
    expect(u).toMatch(/WIDTH=(\d+)&HEIGHT=\1/);
    expect(u).toContain("FORMAT=image/jpeg");
  }

  const box = urls[0]
    .match(/BBOX=([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)/)!
    .slice(1)
    .map(Number);
  const side = box[2] - box[0];
  expect(Math.abs(box[3] - box[1] - side)).toBeLessThan(0.01);
  expect(Math.abs(box[0] / side - Math.round(box[0] / side))).toBeLessThan(1e-6);
  expect(Math.abs(box[1] / side - Math.round(box[1] / side))).toBeLessThan(1e-6);

  // Every tile knows its address, and none sits twice at the same level.
  const perLevel = await page
    .locator("#g-tiles g[data-z]")
    .evaluateAll((gs) =>
      gs.map((g) => [...g.querySelectorAll("image")].map((i) => i.getAttribute("data-url"))),
    );
  for (const level of perLevel) {
    expect(level.every(Boolean)).toBe(true);
    expect(new Set(level).size).toBe(level.length);
  }
});

test("neighboring tiles overlap by a hairline (TILE_SEAM)", async ({ page }) => {
  const checked = await page.evaluate(() => {
    const out: { step: number; width: number; square: boolean }[] = [];
    for (const g of document.querySelectorAll("#g-tiles g[data-z], #g-overlay g[data-z]")) {
      const rects = [...g.querySelectorAll("image")].map((i) =>
        ["x", "width", "height"].map((a) => Number(i.getAttribute(a))),
      );
      const xs = [...new Set(rects.map((r) => r[0]))].sort((a, b) => a - b);
      if (xs.length < 2) continue;
      const step = Math.min(...xs.slice(1).map((x, i) => x - xs[i]));
      for (const r of rects) out.push({ step, width: r[1], square: Math.abs(r[1] - r[2]) < 1e-6 });
    }
    return out;
  });

  expect(checked.length, "mindestens eine Zoomstufe mit zwei Spalten").toBeGreaterThan(0);
  for (const r of checked) {
    expect(r.square, "Kacheln bleiben quadratisch").toBe(true);
    expect(r.width, "Kacheln überlappen ihre Nachbarn").toBeGreaterThan(r.step);
    expect(r.width - r.step, "die Überlappung bleibt eine Haarlinie").toBeLessThan(r.step / 256);
  }
});

test("zooming doesn't request the same tiles again", async ({ page }) => {
  const before = new Set(await tileUrls(page));
  await page.locator("#z-in").click();
  await expect.poll(async () => page.locator("#g-tiles image").count()).toBeGreaterThan(0);
  await page.locator("#z-fit").click();
  await expect.poll(async () => (await tileUrls(page)).some((u) => before.has(u))).toBe(true);
  await expect(page.locator("#attrib")).toBeVisible();
});

test("switching layers clears out the old tiles", async ({ page }) => {
  await page.locator("#layerBtn").click();
  await page.locator('#layerRow [data-bm="alkis"]').click();
  await expect
    .poll(
      async () => {
        const urls = await tileUrls(page);
        return urls.length > 0 && urls.every((u) => /wms_nw_alkis/.test(u));
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  await page.locator('#layerRow [data-bm="dop"]').click();
  await expect
    .poll(
      async () => {
        const urls = await tileUrls(page);
        return urls.length > 0 && urls.every((u) => /wms_nw_dop/.test(u));
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});

test("the ALKIS overlay is its own pyramid and can be toggled", async ({ page }) => {
  // Default: overlay on, so transparent cadastral tiles sit on top.
  await expect(page.locator("#overlayBtn")).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => page.locator("#g-overlay image").count(), { timeout: 15_000 })
    .toBeGreaterThan(0);
  // The overlay pyramid attaches the address directly to href, it doesn't go through queueTile().
  const urls = await page
    .locator("#g-overlay image")
    .evaluateAll((n) => n.map((i) => i.getAttribute("href") ?? ""));
  for (const u of urls) {
    expect(u).toMatch(/wms_nw_alkis/);
    expect(u).toContain("TRANSPARENT=TRUE");
  }

  // Turning it off hides the group but doesn't discard the tiles — turning it back on,
  // they're there immediately instead of reloading.
  await page.locator("#layerBtn").click();
  await page.locator("#overlayBtn").click();
  await expect(page.locator("#overlayBtn")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#g-overlay")).toBeHidden();
  expect(await page.locator("#g-overlay image").count()).toBeGreaterThan(0);

  await page.locator("#overlayBtn").click();
  await expect(page.locator("#overlayBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#g-overlay")).toBeVisible();
  expect(await page.locator("#g-overlay image").count()).toBeGreaterThan(0);
});

test("controls on the map don't trigger panning", async ({ page }) => {
  for (const sel of ["#layerMenu", "#geoQ", "#palette"]) {
    await page.locator(sel).first().dispatchEvent("pointerdown", { bubbles: true });
    await expect(page.locator("#mapwrap")).not.toHaveClass(/panning/);
  }
});
