import { expect, test } from "@playwright/test";
import { linkPlan, smallPlan } from "./fixtures";
import {
  clickMap,
  openPane,
  openPlanner,
  PANE,
  press,
  rightClickMap,
  selectConduit,
  stubOffsite,
  toScreen,
  watchErrors,
} from "./helpers";

// Placing, drawing, dragging, deleting, undo/redo — the part of the first
// jsdom boot from tools/check.mjs that runs in a real browser with a real mouse.

test.beforeEach(async ({ context }) => {
  await stubOffsite(context);
});

test("tools place camera, AP, junction, and house", async ({ page }) => {
  const errs = watchErrors(page);
  await openPlanner(page, { plan: smallPlan });

  await press(page, "k");
  await expect(page.locator("#t-cam")).toHaveAttribute("aria-pressed", "true");
  await clickMap(page, 500, 400);
  await expect(page.locator("#g-markers .marker.cam")).toHaveCount(2);
  // After placing, the tool goes back to select.
  await expect(page.locator("#t-select")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#pane-sel #f-model")).toBeVisible();

  await press(page, "a");
  await expect(page.locator("#t-ap")).toHaveAttribute("aria-pressed", "true");
  await clickMap(page, 560, 400);
  await expect(page.locator("#g-markers .marker.ap")).toHaveCount(1);

  await press(page, "j");
  await clickMap(page, 620, 400);
  await expect(page.locator("#g-markers .marker.jb")).toHaveCount(1);

  await press(page, "h");
  await expect(page.locator("#t-hub")).toHaveAttribute("aria-pressed", "true");
  await clickMap(page, 680, 400);
  await expect(page.locator("#g-markers .marker.hub")).toHaveCount(2);
  // Connection type and tier are linked.
  await expect(page.locator("#f-speed option")).toHaveCount(5);
  await page.locator("#f-wan").selectOption("dsl");
  await expect(page.locator("#f-speed option")).toHaveCount(4);
  await expect(page.locator("#f-speed")).toHaveValue("50");

  expect(errs, errs.join(" | ")).toEqual([]);
});

test("Esc cancels placing — exactly once", async ({ page }) => {
  await openPlanner(page, { plan: smallPlan });

  await press(page, "k");
  await expect(page.locator("#t-cam")).toHaveAttribute("aria-pressed", "true");
  await press(page, "Escape");
  await expect(page.locator("#t-cam")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#t-select")).toHaveAttribute("aria-pressed", "true");
  await clickMap(page, 500, 400);
  await expect(page.locator("#g-markers .marker.cam")).toHaveCount(1);
});

test("L draws a conduit, C a cable without a duct", async ({ page }) => {
  await openPlanner(page, { plan: linkPlan });

  const conduits = page.locator("#g-conduits g.conduit");
  const before = await conduits.count();

  // Fiber to the junction stays fiber — there it sits in an SFP slot.
  await press(page, "l");
  await expect(page.locator("#t-draw")).toHaveAttribute("aria-pressed", "true");
  await clickMap(page, 700, 300); // J7, shaft with splice box
  await clickMap(page, 900, 900); // S8
  await press(page, "Enter");
  await expect(conduits).toHaveCount(before + 1);
  await expect(page.locator("#f-kind")).toHaveValue("trench");
  expect(
    await conduits
      .last()
      .locator("path.strand")
      .evaluateAll((n) => n.map((p) => p.getAttribute("stroke"))),
  ).toEqual(["var(--accent)"]);

  // The same thing at a camera: there's no SFP port there, so Cat6A plus a hint.
  // Finished by right-click this time — it does the same as Enter.
  await press(page, "l");
  await clickMap(page, 700, 300);
  await clickMap(page, 800, 700); // K2
  await rightClickMap(page, 800, 700);
  await expect(conduits).toHaveCount(before + 2);
  expect(
    await conduits
      .last()
      .locator("path.strand")
      .evaluateAll((n) => n.map((p) => p.getAttribute("stroke"))),
  ).toEqual(["var(--ink-3)"]);
  await expect(page.locator("#toast")).toContainText(/Cat6A statt Glasfaser.*K2/);

  // The cable tool lays copper without a trench from the start.
  await press(page, "c");
  await expect(page.locator("#t-cable")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#t-draw")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('#cat-cond [data-key="cable"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await clickMap(page, 700, 300);
  await clickMap(page, 900, 900);
  await press(page, "Enter");
  const cable = conduits.last();
  expect(
    await cable.locator("path.strand").evaluateAll((n) => n.map((p) => p.getAttribute("stroke"))),
  ).toEqual(["var(--ink-3)"]);
  await expect(cable.locator("path.trench")).toHaveCount(0);
  await expect(cable.locator("path.duct")).toHaveCount(0);
  await expect(page.locator("#f-kind")).toHaveValue("cable");
});

test("element and conduit point can be dragged", async ({ page }) => {
  await openPlanner(page, { plan: smallPlan });

  // Dragging an element: the position in the plan follows along.
  const before = await page.evaluate(() => {
    const id = localStorage.getItem("sl-current");
    return JSON.parse(localStorage.getItem(`sl-plan:${id}`)!).items.find(
      (i: { id: string }) => i.id === "k1",
    );
  });
  // Grab from the marker itself, not via a computed map position: its bounding
  // box is the truth, even while the viewBox is still catching up.
  const grip = await page.locator('#g-markers .marker[data-id="k1"] .body').boundingBox();
  const from = { x: grip!.x + grip!.width / 2, y: grip!.y + grip!.height / 2 };
  const to = await toScreen(page, 380, 260);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const id = localStorage.getItem("sl-current");
        return JSON.parse(localStorage.getItem(`sl-plan:${id}`)!).items.find(
          (i: { id: string }) => i.id === "k1",
        ).x;
      }),
    )
    .toBeGreaterThan(before.x + 50);
  // The conduit end hangs off the element and has moved along with it.
  const end = await page.evaluate(() => {
    const id = localStorage.getItem("sl-current");
    const c = JSON.parse(localStorage.getItem(`sl-plan:${id}`)!).conduits[0];
    return c.points[c.points.length - 1];
  });
  expect(end.at).toBe("k1");
  expect(Math.round(end.x)).toBeGreaterThan(350);

  // Setting and dragging a midpoint: double-clicking the duct adds one.
  // The center of the hit area lies on the line for a straight conduit.
  await selectConduit(page, "Kupfer");
  const handles = page.locator("#g-handles .vtx");
  await expect(handles).toHaveCount(2);
  const core = await page.locator(".conduit.selected path.core").boundingBox();
  await page.mouse.dblclick(core!.x + core!.width / 2, core!.y + core!.height / 2);
  await expect(handles).toHaveCount(3);
  const box = await handles.nth(1).boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2 - 40, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const id = localStorage.getItem("sl-current");
        return JSON.parse(localStorage.getItem(`sl-plan:${id}`)!).conduits[0].points[1].x;
      }),
    )
    .toBeGreaterThan(245);
});

test("delete and undo/redo restore the state", async ({ page }) => {
  await openPlanner(page, { plan: smallPlan });

  await openPane(page, PANE.list);
  await page.locator("#l-cams .lrow").first().click();
  await expect(page.locator("#g-markers .marker.cam")).toHaveCount(1);

  await page.locator("#pane-sel .selhead #f-del").click();
  await expect(page.locator("#g-markers .marker.cam")).toHaveCount(0);

  await page.keyboard.press("Control+z");
  await expect(page.locator("#g-markers .marker.cam")).toHaveCount(1);
  await page.keyboard.press("Control+y");
  await expect(page.locator("#g-markers .marker.cam")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.locator("#g-markers .marker.cam")).toHaveCount(1);
  // Ctrl+Shift+Z is the second spelling for redo.
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator("#g-markers .marker.cam")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.locator("#g-markers .marker.cam")).toHaveCount(1);
  // After the last undo the history is empty, but redo is still armed.
  await expect(page.locator("#t-redo")).toBeEnabled();

  // Delete on the selection does the same thing.
  await page.locator("#l-cams .lrow").first().click();
  await press(page, "Delete");
  await expect(page.locator("#g-markers .marker.cam")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.locator("#g-markers .marker.cam")).toHaveCount(1);
});

test("double-clicking a point removes it", async ({ page }) => {
  await openPlanner(page, { plan: smallPlan });
  await selectConduit(page, "Kupfer");

  const handles = page.locator("#g-handles .vtx");
  await expect(handles).toHaveCount(2);
  const core = await page.locator(".conduit.selected path.core").boundingBox();
  await page.mouse.dblclick(core!.x + core!.width / 2, core!.y + core!.height / 2);
  await expect(handles).toHaveCount(3);

  const box = await handles.nth(1).boundingBox();
  await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(handles).toHaveCount(2);
});
