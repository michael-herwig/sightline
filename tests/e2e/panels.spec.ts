import { expect, test } from "@playwright/test";
import { linkPlan } from "./fixtures";
import {
  listRow,
  openPane,
  openPlanner,
  PANE,
  selectMarker,
  stubOffsite,
  toggleSwitch,
} from "./helpers";

// Panels only rebuild their scaffolding when the signature changes. The scroll
// position depends on that — that's exactly what these tests are for. Source: tools/check.mjs.

test.beforeEach(async ({ context, page }) => {
  await stubOffsite(context);
  await openPlanner(page, { plan: linkPlan });
});

test("selection panel doesn't get rebuilt and keeps the scroll position", async ({ page }) => {
  await openPane(page, PANE.list);
  await listRow(page, "l-jbs", "J5").first().click();

  // Mark on the scaffolding: if it survives, the panel wasn't discarded.
  await page
    .locator("#pane-sel h2")
    .first()
    .evaluate((n) => n.setAttribute("data-probe", "x"));
  await page.locator("#pane-sel").evaluate((n) => {
    n.scrollTop = 120;
  });
  const scrolled = await page.locator("#pane-sel").evaluate((n) => n.scrollTop);
  expect(scrolled).toBeGreaterThan(0);

  // The same selection again: same signature, so only values get updated.
  await listRow(page, "l-jbs", "J5").first().click();
  await expect(page.locator("#pane-sel h2").first()).toHaveAttribute("data-probe", "x");
  expect(await page.locator("#pane-sel").evaluate((n) => n.scrollTop)).toBe(scrolled);

  // Changing a field doesn't rebuild the scaffolding either.
  await page.locator("#f-note").fill("Prüfnotiz");
  await page.locator("#f-note").press("Tab");
  await expect(page.locator("#pane-sel h2").first()).toHaveAttribute("data-probe", "x");
});

test("build panel and catalog buttons stay the same nodes", async ({ page }) => {
  await openPane(page, PANE.build);
  await page.locator("#pane-build").evaluate((n) => n.setAttribute("data-probe", "x"));
  await page
    .locator("#cat-cams .item")
    .first()
    .evaluate((n) => n.setAttribute("data-probe", "y"));

  await page.locator("#cat-cams .item").first().click();
  await expect(page.locator("#pane-build")).toHaveAttribute("data-probe", "x");
  await expect(page.locator("#cat-cams .item").first()).toHaveAttribute("data-probe", "y");
  await expect(page.locator("#cat-cams .item").first()).toHaveAttribute("aria-pressed", "true");
  await page.locator("#t-select").click();
});

test("the ⓘ opens the datasheet without putting anything into the point", async ({ page }) => {
  await openPane(page, PANE.list);
  await listRow(page, "l-jbs", "J9").first().click();
  await expect(page.locator("#pane-sel .product")).toHaveCount(0);

  // ⓘ next to the housing select
  await page.locator("#f-modeli").click();
  await expect(page.locator("#infoDlg")).toHaveAttribute("open", "");
  await expect(page.locator("#infoHead")).toContainText("Kabelschacht");
  await expect(page.locator("#infoBody .product")).toHaveCount(1);
  await page.locator("#infoClose").click();
  await expect(page.locator("#infoDlg")).not.toHaveAttribute("open", /.*/);

  // ⓘ on a catalog card: no device, no tool.
  await openPane(page, PANE.build);
  await page.locator('#cat-tabs [data-tab="jb"]').click();
  const card = page
    .locator('#cat-jbs [data-key="conv"]')
    .locator('xpath=ancestor::*[contains(@class,"itemrow")][1]');
  await expect(card.locator("button")).toHaveCount(2);
  await card.locator(".iteminfo").click();
  await expect(page.locator("#infoDlg")).toHaveAttribute("open", "");
  await expect(page.locator("#infoHead")).toContainText(/Medienkonverter|converter/i);
  await expect(page.locator("#t-jb")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#infoClose").click();

  await openPane(page, PANE.list);
  await listRow(page, "l-jbs", "J9").first().click();
  await expect(page.locator("#f-gears .cabrow")).toHaveCount(0);
});

test("device select carries its four groups, the housing select three", async ({ page }) => {
  await openPane(page, PANE.list);
  await listRow(page, "l-jbs", "J9").first().click();

  const groups = await page
    .locator("#f-gear-new optgroup")
    .evaluateAll((n) => n.map((g) => g.getAttribute("label")));
  expect(groups).toEqual([
    "Switch mit PoE",
    "Switch/Konverter ohne PoE",
    "Speisung (Injektor, Extender)",
    "Zubehör (ohne Strom)",
  ]);
  expect(
    await page
      .locator("#f-gear-new option")
      .evaluateAll((n) => n.every((o) => o.parentElement?.tagName === "OPTGROUP")),
  ).toBe(true);
  const groupOf = (key: string) =>
    page
      .locator("#f-gear-new option")
      .evaluateAll(
        (n, k) =>
          n
            .find((o) => (o as HTMLOptionElement).value === k)
            ?.parentElement?.getAttribute("label") ?? "",
        key,
      );
  expect(await groupOf("tplink-poe170s")).toMatch(/Speisung/);
  expect(await groupOf("trendnet-tpe-e100")).toMatch(/Speisung/);
  expect(await groupOf("usw-ultra-60w")).toMatch(/Switch mit PoE/);
  expect(await groupOf("tplink-mc220l")).toMatch(/ohne PoE/);
  expect(await groupOf("tplink-sm311ls")).toMatch(/Zubehör/);

  expect(
    await page
      .locator("#f-model optgroup")
      .evaluateAll((n) => n.map((g) => g.getAttribute("label"))),
  ).toEqual(["Erdverlegt", "Außen an der Wand", "Innen"]);
});

test("hover card is one node, appears with a delay, and leaves nothing behind", async ({
  page,
}) => {
  await openPane(page, PANE.list);
  await listRow(page, "l-jbs", "J5").first().click();

  const card = page.locator("#hovercard");
  await expect(card).toHaveCount(1);
  await expect(card).toBeHidden();

  // J5 carries a converter and a switch; the second row is the switch.
  const rows = page.locator("#f-gears .cabrow[data-hover]");
  await expect(rows).toHaveCount(2);
  await rows.nth(1).hover();
  await expect(card).toBeVisible();
  await expect(card).toContainText("USW Ultra");
  await expect(card).toContainText("8× PoE");
  await expect(page.locator("#hovercard")).toHaveCount(1);

  await page.locator("#f-link").hover();
  await expect(card).toBeHidden();

  const plan = await page.evaluate(
    () => localStorage.getItem(`sl-plan:${localStorage.getItem("sl-current")}`) ?? "",
  );
  expect(plan).not.toMatch(/hover/i);
});

test("display runs via factors and CSS variables, not via redrawing", async ({ page }) => {
  await expect(page.locator("#lookPanel")).toHaveCount(1);
  await expect(page.locator("#lookMenu")).not.toHaveClass(/open/);
  await page.locator("#lookBtn").click();
  await expect(page.locator("#lookMenu")).toHaveClass(/open/);
  await expect(page.locator("#lookBtn")).toHaveAttribute("aria-expanded", "true");

  const factor = () =>
    page
      .locator("#g-markers .marker")
      .first()
      .evaluate((n) => Number(/scale\(([\d.]+)\)/.exec(n.getAttribute("transform") ?? "")?.[1]));
  const slide = async (id: string, v: string) => {
    await page.locator(`#${id}`).evaluate((n, val) => {
      (n as HTMLInputElement).value = val;
      n.dispatchEvent(new Event("input", { bubbles: true }));
      n.dispatchEvent(new Event("change", { bubbles: true }));
    }, v);
  };

  await page
    .locator("#g-markers .marker")
    .first()
    .evaluate((n) => n.setAttribute("data-probe", "x"));
  const before = await factor();
  await slide("look-size", "1.4");
  await expect(page.locator("#g-markers .marker").first()).toHaveAttribute("data-probe", "x");
  expect(Math.abs((await factor()) / before - 1.4)).toBeLessThan(1e-3);
  await expect(page.locator("#look-size-v")).toHaveText("1,4");

  const cssVar = (name: string) =>
    page.locator("svg.map").evaluate((n, v) => (n as SVGElement).style.getPropertyValue(v), name);
  await slide("look-alpha", "0.3");
  expect(await cssVar("--look-alpha")).toBe("0.3");
  await slide("look-font", "1.3");
  expect(await cssVar("--look-font")).toBe("1.3");
  await slide("look-line", "1.5");
  expect(await cssVar("--look-line")).toBe("1.5");
  // The clone for image export and PDF carries the display along.
  expect(
    await page
      .locator("svg.map")
      .evaluate((n) => (n.cloneNode(true) as SVGElement).style.getPropertyValue("--look-alpha")),
  ).toBe("0.3");

  await page.locator("#look-reset").click();
  expect(await cssVar("--look-alpha")).toBe("1");
  await expect(page.locator("#look-size")).toHaveValue("1");
  await expect(page.locator("#look-cluster")).toBeChecked();
});

test("groups: toggle off means every marker stands on its own", async ({ page }) => {
  await page.locator("#lookBtn").click();
  for (let i = 0; i < 6; i++) await page.locator("#z-out").click();
  await expect(page.locator("#g-markers .marker.cluster").first()).toBeAttached();

  const single =
    (await page.locator("#g-markers .marker").count()) -
    (await page.locator("#g-markers .marker.cluster").count());
  expect(single).toBeLessThan(24);

  await toggleSwitch(page, "look-cluster");
  await expect(page.locator("#look-cluster")).not.toBeChecked();
  await expect(page.locator("#g-markers .marker.cluster")).toHaveCount(0);
  await expect(page.locator("#g-markers .marker")).toHaveCount(24);

  await toggleSwitch(page, "look-cluster");
  await expect(page.locator("#look-cluster")).toBeChecked();
  await expect(page.locator("#g-markers .marker.cluster").first()).toBeAttached();
});

test("the hub is a catalog tab without a map", async ({ page }) => {
  await openPane(page, PANE.build);
  const tab = page.locator('#cat-tabs [data-tab="gear"]');
  await expect(tab).toHaveCount(1);
  await tab.click();
  expect(await page.locator("#cat-gear .item").count()).toBeGreaterThanOrEqual(10);
  await expect(page.locator("#cat-gear")).not.toContainText("USW Flex");

  await page.locator('#cat-gear [data-kind="gear"][data-key="unvr"]').click();
  await expect(page.locator("#f-qty")).toHaveValue("1");
  await expect(page.locator("#pane-sel .product")).toHaveCount(0);
  await page.locator('#cat-gear [data-key="unvr"]').click();
  await expect(page.locator("#f-qty")).toHaveValue("2");

  await openPane(page, PANE.list);
  const rows = page.locator("#l-gear .lrow");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "UNVR" })).toContainText("2 ×");
  await rows.filter({ hasText: "UNVR" }).locator(".del").click();
  await expect(page.locator("#l-gear .lrow")).toHaveCount(1);
});

test("conduit panel: one block per duct, quantities individually, costs follow along", async ({
  page,
}) => {
  await openPane(page, PANE.list);
  await page
    .locator("#l-conds .lrow")
    .filter({ has: page.locator(".t", { hasText: /^Zentralkabel/ }) })
    .first()
    .click();

  await expect(page.locator("#f-kind")).toHaveValue("trench");
  await expect(page.locator("#f-ducts .duct")).toHaveCount(1);
  await expect(page.locator("#f-duct-pipe-0")).toHaveValue("dn50");
  await expect(page.locator("#f-cab-0-0")).toHaveValue("1");

  const total = () => page.locator("#totalChip").textContent();
  const t0 = await total();
  await page.locator("#f-duct-add").click();
  await expect(page.locator("#f-ducts .duct")).toHaveCount(2);
  await expect(page.locator("#f-cabs-1 .cabrow")).toHaveCount(0);
  await expect(page.locator("#f-duct-pipe-1")).toHaveValue("dn50");
  const t1 = await total();
  expect(t1).not.toBe(t0);

  await page.keyboard.press("Control+z");
  expect(await total()).toBe(t0);
  await page.keyboard.press("Control+y");
  expect(await total()).toBe(t1);
});

test("marker on the map fills the same panel as the list", async ({ page }) => {
  await selectMarker(page, "k1");
  await expect(page.locator("#pane-sel")).toContainText("K1");
  await expect(page.locator("#pane-sel #f-model")).toBeVisible();
  await expect(page.locator("#pane-sel .selhead #f-del")).toHaveCount(1);
  await expect(page.locator("#pane-sel .selhead #f-dup")).toHaveCount(1);
  await expect(page.locator("#pane-sel .product")).toHaveCount(0);
});
