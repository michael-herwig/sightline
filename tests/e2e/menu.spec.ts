import { expect, test, type Page } from "@playwright/test";
import { smallPlan } from "./fixtures";
import { clickMap, openPlanner, press, rightClickMap, stubOffsite, watchErrors } from "./helpers";

// The planner's own context menu (src/planer/menu.ts): one #ctxMenu node, filled from
// whatever the right-click hit, gone again afterwards. Nothing of it may reach `state`.

const menu = (page: Page) => page.locator("#ctxMenu");

const entry = (page: Page, name: RegExp) => menu(page).getByRole("menuitem", { name });

/** Right-click an element on the map — the marker body, like a user would. */
const rightClickMarker = (page: Page, id: string) =>
  page.locator(`#g-markers .marker[data-id="${id}"] .body`).first().click({ button: "right" });

/** Heading of a camera, read off the direction line it draws. */
const heading = (page: Page, id: string) =>
  page.locator(`#g-markers .marker[data-id="${id}"] line.dir`).evaluate((n) => {
    const x = Number(n.getAttribute("x2")),
      y = Number(n.getAttribute("y2"));
    return ((Math.round((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360;
  });

test.beforeEach(async ({ context }) => {
  await stubOffsite(context);
});

test("map background: places a camera at the click point", async ({ page }) => {
  const errs = watchErrors(page);
  await openPlanner(page, { plan: smallPlan });

  await rightClickMap(page, 400, 300);
  await expect(menu(page)).toBeVisible();
  // Four kinds to place, two to start drawing, one to centre — nothing else out here.
  await expect(menu(page).getByRole("menuitem")).toHaveCount(7);

  await entry(page, /^Kamera hier setzen$/).click();
  await expect(menu(page)).toBeHidden();
  await expect(page.locator("#g-markers .marker.cam")).toHaveCount(2);
  // Placing goes through the same path as the palette, so the tool falls back to select.
  await expect(page.locator("#t-select")).toHaveAttribute("aria-pressed", "true");

  const p = await page
    .locator("#g-markers .marker.cam")
    .last()
    .evaluate((n) => [Number(n.getAttribute("data-sx")), Number(n.getAttribute("data-sy"))]);
  expect(Math.abs(p[0] - 400)).toBeLessThan(2);
  expect(Math.abs(p[1] - 300)).toBeLessThan(2);

  expect(errs, errs.join(" | ")).toEqual([]);
});

test("element: delete removes it, and the menu closes", async ({ page }) => {
  await openPlanner(page, { plan: smallPlan });

  await rightClickMarker(page, "k1");
  await expect(menu(page)).toBeVisible();
  await entry(page, /^Löschen$/).click();
  await expect(menu(page)).toBeHidden();
  await expect(page.locator('#g-markers .marker[data-id="k1"]')).toHaveCount(0);
});

test("element: point at … turns the camera with the next click", async ({ page }) => {
  await openPlanner(page, { plan: smallPlan });
  expect(await heading(page, "k1")).toBe(0);

  await rightClickMarker(page, "k1");
  await entry(page, /^Ausrichten auf/).click();
  await expect(menu(page)).toBeHidden();
  await expect(page.locator("#mapwrap")).toHaveClass(/aiming/);

  // k1 sits at (300, 200); straight below it is 90°.
  await clickMap(page, 300, 500);
  await expect(page.locator("#mapwrap")).not.toHaveClass(/aiming/);
  expect(await heading(page, "k1")).toBe(90);

  // Esc cancels an aim that has not been used yet — and changes nothing.
  await rightClickMarker(page, "k1");
  await entry(page, /^Ausrichten auf/).click();
  await press(page, "Escape");
  await expect(page.locator("#mapwrap")).not.toHaveClass(/aiming/);
  await clickMap(page, 500, 300);
  expect(await heading(page, "k1")).toBe(90);
});

test("conduit: insert a point, and the handle count goes up by one", async ({ page }) => {
  await openPlanner(page, { plan: smallPlan });

  await page
    .locator('#g-conduits g.conduit[data-id="cc"] path.core')
    .click({ button: "right", force: true });
  await expect(menu(page)).toBeVisible();
  await entry(page, /^Punkt hier einfügen$/).click();

  // Inserting selects the conduit, so its handles are the ones on screen.
  await expect(page.locator("#g-handles circle.vtx")).toHaveCount(3);
  // The new point is a free one; the two ends stay bound to their elements.
  await expect(page.locator("#g-handles circle.vtx.bound")).toHaveCount(2);
});

test("conduit point: detach from the element clears the bond", async ({ page }) => {
  await openPlanner(page, { plan: smallPlan });

  await page.locator('#g-conduits g.conduit[data-id="cc"] path.core').click({ force: true });
  await expect(page.locator("#g-handles circle.vtx.bound")).toHaveCount(2);

  await page.locator("#g-handles circle.vtx.bound").last().click({ button: "right" });
  await expect(menu(page)).toBeVisible();
  // Two points only — removing one would leave no conduit, so that entry is absent.
  await expect(menu(page).getByRole("menuitem")).toHaveCount(1);
  await entry(page, /^Vom Element lösen$/).click();
  await expect(page.locator("#g-handles circle.vtx.bound")).toHaveCount(1);
});

test("keyboard: arrows, Home/End and Esc drive the menu", async ({ page }) => {
  await openPlanner(page, { plan: smallPlan });

  await rightClickMap(page, 400, 300);
  const items = menu(page).getByRole("menuitem");
  const focused = () => page.evaluate(() => document.activeElement?.textContent ?? "");
  const texts = await items.allTextContents();

  expect(await focused()).toBe(texts[0]);
  await page.keyboard.press("ArrowDown");
  expect(await focused()).toBe(texts[1]);
  await page.keyboard.press("End");
  expect(await focused()).toBe(texts[texts.length - 1]);
  await page.keyboard.press("Home");
  expect(await focused()).toBe(texts[0]);

  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
  // Esc went to the menu, not to the tools — nothing else was cancelled.
  await expect(page.locator("#t-select")).toHaveAttribute("aria-pressed", "true");

  // Enter on a focused entry runs it, like on any button.
  await rightClickMap(page, 400, 300);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(menu(page)).toBeHidden();
  await expect(page.locator("#g-markers .marker.hub")).toHaveCount(2);
});

test("while drawing there is no menu — right-click finishes the draft", async ({ page }) => {
  await openPlanner(page, { plan: smallPlan });
  const conduits = page.locator("#g-conduits g.conduit");
  const before = await conduits.count();

  await press(page, "l");
  await clickMap(page, 400, 300);
  await clickMap(page, 500, 400);
  await rightClickMap(page, 500, 400);

  await expect(menu(page)).toBeHidden();
  await expect(conduits).toHaveCount(before + 1);
  await expect(page.locator("#t-select")).toHaveAttribute("aria-pressed", "true");
});

test("an outside click closes the menu without doing anything", async ({ page }) => {
  await openPlanner(page, { plan: smallPlan });

  await rightClickMarker(page, "k1");
  await expect(menu(page)).toBeVisible();
  // Up and to the left of the marker — the menu itself opens down and to the right.
  await clickMap(page, 100, 350);
  await expect(menu(page)).toBeHidden();
  await expect(page.locator("#g-markers .marker")).toHaveCount(2);
});
