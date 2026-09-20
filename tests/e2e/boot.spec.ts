import { expect, test } from "@playwright/test";
import { drawPlan } from "./fixtures";
import { openPane, openPlanner, PANE, stubOffsite, watchErrors } from "./helpers";

// Ported from the first jsdom boot in tools/check.mjs: the page boots up, the
// layout is in place, language, catalog, and basemap are operable.

test.beforeEach(async ({ context }) => {
  await stubOffsite(context);
});

test("boots without console errors and draws the plan", async ({ page }) => {
  const errs = watchErrors(page);
  await openPlanner(page, { plan: drawPlan });

  await expect(page.locator("#g-markers .marker.cam")).toHaveCount(2);
  await expect(page.locator("#g-markers .marker.jb").first()).toBeVisible();
  expect(await page.locator("#g-conduits g.conduit").count()).toBeGreaterThanOrEqual(3);
  expect(errs, errs.join(" | ")).toEqual([]);
});

test("dockview takes over the surface, every panel is mounted in it", async ({ page }) => {
  await openPlanner(page, { plan: drawPlan });

  await expect(page.locator("#dock")).not.toHaveClass(/plainlayout/);
  await expect(page.locator("#dock .dv-dockview")).toBeVisible();
  expect(await page.locator("#dock .dv-tab").count()).toBeGreaterThanOrEqual(4);
  for (const id of ["mapwrap", "pane-build"]) {
    expect(
      await page.evaluate(
        (x) => document.getElementById("dock")!.contains(document.getElementById(x)),
        id,
      ),
    ).toBe(true);
  }

  // The view menu lists all panels plus reset. It only builds itself in the
  // `toggle` event, so don't count immediately after the click.
  await page.locator("#viewMenu > summary").click();
  await expect.poll(() => page.locator("#viewList button").count()).toBeGreaterThanOrEqual(6);
  expect(await page.locator("#viewList button:not(.off)").count()).toBeGreaterThanOrEqual(5);
  await page.locator("#viewMenu > summary").click();

  // An unmounted panel still got filled — that's exactly what used to go wrong.
  await openPane(page, PANE.list);
  expect(await page.locator("#pane-list .lrow").count()).toBeGreaterThanOrEqual(8);
  await expect(page.locator("#pane-sel")).toContainText("Nichts ausgewählt");
});

test("language toggle switches texts, attribute, and localStorage", async ({ page }) => {
  await openPlanner(page, { plan: drawPlan });
  await openPane(page, PANE.build);

  await expect(page.locator("#t-lang")).toHaveText("DE");
  await expect(page.locator("#pane-build")).toContainText("Kameras");

  await page.locator("#t-lang").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#t-lang")).toHaveText("EN");
  await expect(page.locator("#pane-build")).toContainText("Cameras");
  expect(await page.evaluate(() => localStorage.getItem("sl-lang"))).toBe("en");
  // Static texts hang off data-i18n and follow along.
  await expect(page.locator('[data-i18n="tool.select"]')).toHaveText("Select");

  await page.locator("#t-lang").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  expect(await page.evaluate(() => localStorage.getItem("sl-lang"))).toBe("de");
  await expect(page.locator('[data-i18n="tool.select"]')).toHaveText("Auswählen");
});

test("catalog: tabs, search, and filter badges", async ({ page }) => {
  await openPlanner(page, { plan: drawPlan });
  await openPane(page, PANE.build);

  await expect(page.locator("#cat-tabs .seg")).toHaveCount(5);
  await expect(page.locator("#pane-build .cat")).toHaveCount(1);
  await expect(page.locator("#cat-q")).toBeVisible();
  expect(await page.locator("#cat-chips .chip[data-facet]").count()).toBeGreaterThanOrEqual(8);
  expect(await page.locator("#cat-cams .item").count()).toBeGreaterThanOrEqual(9);

  await page.locator("#cat-q").fill("ptz");
  await expect(page.locator("#cat-cams .item")).toHaveCount(2);
  await page.locator("#cat-q").fill("reolink");
  await expect(page.locator("#cat-cams .item")).toHaveCount(8);

  // "außen" is both a property and a search term.
  await page.locator("#cat-q").fill("outdoor");
  const cards = page.locator("#cat-cams .item .d");
  expect(await cards.count()).toBeGreaterThanOrEqual(10);
  for (const txt of await cards.allTextContents()) expect(txt).toMatch(/ · außen$/);
  await page.locator("#cat-q").fill("innen");
  expect(await cards.count()).toBeGreaterThanOrEqual(3);
  for (const txt of await cards.allTextContents()) expect(txt).toMatch(/ · nur innen$/);

  // The filter badge narrows further without rebuilding the list.
  await page.locator("#cat-q").fill("");
  const all = await page.locator("#cat-cams .item").count();
  await page.locator("#cat-chips .chip[data-facet]").first().click();
  await expect(page.locator("#cat-chips .chip[data-facet]").first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await page.locator("#cat-cams .item").count()).toBeLessThan(all);
  await page.locator("#cat-chips .chip[data-facet]").first().click();
  await expect(page.locator("#cat-cams .item")).toHaveCount(all);
});

test("basemap is selectable and the source is shown", async ({ page }) => {
  await openPlanner(page, { plan: drawPlan });

  await expect(page.locator("#layerRow [data-bm]")).toHaveCount(2);
  await expect(page.locator('#layerRow [data-bm="dop"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('#layerRow [data-bm="alkis"]')).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(page.locator("#attrib")).toBeVisible();
  await expect(page.locator("#attrib")).not.toHaveText("");

  await page.locator("#layerBtn").click();
  await expect(page.locator("#layerMenu")).toHaveClass(/open/);
  await page.locator('#layerRow [data-bm="alkis"]').click();
  await expect(page.locator('#layerRow [data-bm="alkis"]')).toHaveAttribute("aria-checked", "true");
  // Without aerial imagery underneath, the overlay is pointless and therefore off.
  await expect(page.locator("#overlayBtn")).toBeDisabled();
});

test("help and navigation from within the planner", async ({ page }) => {
  await openPlanner(page, { plan: drawPlan });

  await page.locator("#t-help").click();
  await expect(page.locator("#helpDlg")).toHaveAttribute("open", "");
  await expect(page.locator("#helpBody")).toContainText("Glasfaser geht nie direkt");
  expect(await page.locator("#helpBody kbd").count()).toBeGreaterThanOrEqual(8);
  await expect(page.locator("#helpDocs")).toHaveAttribute("href", "/help");
  await expect(page.locator("#t-home")).toHaveAttribute("href", "/");
  await page.locator("#helpClose").click();
  await expect(page.locator("#helpDlg")).not.toHaveAttribute("open", /.*/);
});
