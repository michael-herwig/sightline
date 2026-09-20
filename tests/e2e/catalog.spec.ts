import { expect, test } from "@playwright/test";
import { drawPlan } from "./fixtures";
import { openPane, openPlanner, PANE, stubOffsite } from "./helpers";

// The product directory in the browser: the openness facet really filters, and
// the two new rows really reach the data sheet.

test.beforeEach(async ({ context, page }) => {
  await stubOffsite(context);
  await openPlanner(page, { plan: drawPlan });
  await openPane(page, PANE.build);
});

test("the open-standards chip keeps the cameras that speak RTSP and ONVIF", async ({ page }) => {
  const cards = page.locator("#cat-cams .item");
  const all = await cards.count();
  expect(all).toBeGreaterThan(10);

  await page.locator('#cat-chips .chip[data-facet="open"]').click();
  await expect(page.locator('#cat-chips .chip[data-facet="open"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const open = await cards.count();
  expect(open).toBeGreaterThan(0);
  expect(open).toBeLessThan(all);

  // A UniFi Protect camera only re-streams through its console — no ONVIF, so it
  // drops out. The RLC-810WA speaks both and stays.
  await expect(page.locator('#cat-cams [data-key="g6-bullet"]')).toHaveCount(0);
  await expect(page.locator('#cat-cams [data-key="reolink-rlc-810wa"]')).toHaveCount(1);

  await page.locator('#cat-chips .chip[data-facet="open"]').click();
  await expect(cards).toHaveCount(all);
});

test("show-deprecated exists in every tab and changes nothing while nothing is", async ({
  page,
}) => {
  const chip = page.locator('#cat-chips .chip[data-facet="dep"]');
  await expect(chip).toHaveCount(1);
  const before = await page.locator("#cat-cams .item").count();
  await chip.click();
  await expect(page.locator("#cat-cams .item")).toHaveCount(before);

  await page.locator('#cat-tabs [data-tab="jb"]').click();
  await expect(page.locator('#cat-chips .chip[data-facet="dep"]')).toHaveCount(1);
});

test("the data sheet carries an openness row and a codec row", async ({ page }) => {
  const card = page
    .locator('#cat-cams [data-key="g6-bullet"]')
    .locator('xpath=ancestor::*[contains(@class,"itemrow")][1]');
  await card.locator(".iteminfo").click();
  await expect(page.locator("#infoDlg")).toHaveAttribute("open", "");

  const rows = page.locator("#infoBody dl.spec");
  await expect(rows.first()).toContainText("Offenheit");
  await expect(rows.first()).toContainText("RTSP nur über die Hersteller-Konsole");
  // Ubiquiti publishes no codec list, and an unchecked field says so instead of
  // pretending to an answer.
  await expect(rows.first()).toContainText("Codecs");
  await expect(page.locator("#infoBody dd.none")).toHaveCount(1);
  await page.locator("#infoClose").click();

  // A camera that was checked shows the real answer on both rows.
  const reo = page
    .locator('#cat-cams [data-key="reolink-rlc-810wa"]')
    .locator('xpath=ancestor::*[contains(@class,"itemrow")][1]');
  await reo.locator(".iteminfo").click();
  await expect(page.locator("#infoBody dl.spec").first()).toContainText("RTSP · ONVIF");
  await expect(page.locator("#infoBody dl.spec").first()).toContainText("H.265 · Sub H.264");
});
