import { expect, test } from "@playwright/test";
import { GEO, type Plan } from "./fixtures";
import { openPane, openPlanner, PANE, selectMarker, stubOffsite, watchErrors } from "./helpers";

// The heading dial, the lobes of a directional access point, and the hover card on a
// marker. A camera and a U7 Outdoor sit far enough apart not to collapse into a group.
const headingPlan: Plan = {
  name: "Ausrichtung",
  sub: "Musterdorf",
  lang: "de",
  budget: 3000,
  earthwork: 0,
  seq: 4,
  geo: { ...GEO },
  // A fixed viewport: the default start box spans 2.5 km, and at that zoom any two of
  // these would collapse into one group marker.
  view: { x: 0, y: 0, w: 1400, h: 1000 },
  items: [
    { id: "k1", kind: "cam", model: "g6-bullet", label: "K1", x: 200, y: 200, rot: 0, note: "Tor" },
    // Directional: `beam.h` 45, `beam.hFar` 90 — two lobes, not two circles.
    { id: "a1", kind: "ap", model: "u7-outdoor", label: "A1", x: 900, y: 700, note: "Hof" },
    // Omnidirectional, for the counter-example.
    { id: "a2", kind: "ap", model: "u7-pro", label: "A2", x: 200, y: 700, note: "innen" },
  ],
  conduits: [],
};

/** The `rot` of an element, straight out of the live state. */
const rotOf = (page: import("@playwright/test").Page, id: string) =>
  page.evaluate((k) => {
    const raw = localStorage.getItem(`sl-plan:${localStorage.getItem("sl-current")}`);
    const plan = JSON.parse(raw ?? "{}");
    return (plan.items ?? []).find((i: { id: string }) => i.id === k)?.rot;
  }, id);

/** Centre of the dial in screen coordinates. */
async function dialCentre(page: import("@playwright/test").Page) {
  const box = await page.locator("#f-dial").boundingBox();
  expect(box).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2, r: box!.width / 2 };
}

test.beforeEach(async ({ context }) => {
  await stubOffsite(context);
});

test("the dial turns the camera — marker, cone and number follow", async ({ page }) => {
  const errs = watchErrors(page);
  await openPlanner(page, { plan: headingPlan });
  await openPane(page, PANE.sel);
  await selectMarker(page, "k1");

  const dial = page.locator("#f-dial");
  await expect(dial).toHaveAttribute("role", "slider");
  await expect(dial).toHaveAttribute("aria-valuenow", "0");
  await expect(page.locator("#f-rot")).toHaveValue("0");

  // Drag around the ring to due south: 90° in map angles, straight below the centre.
  const c = await dialCentre(page);
  await page.mouse.move(c.x + c.r * 0.8, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x, c.y + c.r * 0.8, { steps: 8 });
  await page.mouse.up();

  await expect(dial).toHaveAttribute("aria-valuenow", "90");
  await expect(page.locator("#f-rot")).toHaveValue("90");
  await expect(page.locator("#f-dial-needle")).toHaveAttribute("transform", "rotate(90)");
  await expect(page.locator("#f-dial-wedge")).toHaveAttribute("transform", "rotate(90)");
  // The handle on the map sits on the same heading — below the marker now.
  const marker = page.locator('#g-markers .marker[data-id="k1"]');
  const handle = await marker.locator(".rothandle").boundingBox();
  const body = await marker.locator(".body").boundingBox();
  expect(handle!.y).toBeGreaterThan(body!.y + body!.height / 2);
  // Released means committed: undo takes the plan back.
  expect(await rotOf(page, "k1")).toBe(90);

  expect(errs, errs.join(" | ")).toEqual([]);
});

test("wheel steps 1°, Shift+wheel 15°, arrow keys the same", async ({ page }) => {
  await openPlanner(page, { plan: headingPlan });
  await openPane(page, PANE.sel);
  await selectMarker(page, "k1");

  const dial = page.locator("#f-dial");
  const c = await dialCentre(page);
  await page.mouse.move(c.x, c.y);

  await page.mouse.wheel(0, 120);
  await expect(dial).toHaveAttribute("aria-valuenow", "1");
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 120);
  await expect(dial).toHaveAttribute("aria-valuenow", "16");
  await page.keyboard.up("Shift");

  await dial.focus();
  await dial.press("ArrowLeft");
  await expect(dial).toHaveAttribute("aria-valuenow", "15");
  await dial.press("Shift+ArrowLeft");
  await expect(dial).toHaveAttribute("aria-valuenow", "0");
  // 0 − 1 wraps to 359 instead of clamping.
  await dial.press("ArrowLeft");
  await expect(dial).toHaveAttribute("aria-valuenow", "359");
  await expect(page.locator("#f-rot")).toHaveValue("359");
});

test("a directional access point draws two lobes, an omni stays a circle", async ({ page }) => {
  await openPlanner(page, { plan: headingPlan });

  const dir = page.locator('#g-cover .apcover[data-id="a1"]');
  // Front and rear lobe, for the outer and the inner ring: four paths, no circle.
  await expect(dir.locator("path.apcircle")).toHaveCount(4);
  await expect(dir.locator("path.apcircle.back")).toHaveCount(2);
  await expect(dir.locator("circle")).toHaveCount(0);

  const omni = page.locator('#g-cover .apcover[data-id="a2"]');
  await expect(omni.locator("circle.apcircle")).toHaveCount(2);
  await expect(omni.locator("path")).toHaveCount(0);

  // It turns like a camera: the dial is there and the marker carries the handle.
  await openPane(page, PANE.sel);
  await selectMarker(page, "a1");
  await expect(page.locator("#f-dial")).toBeVisible();
  await expect(page.locator('#g-markers .marker[data-id="a1"] .rothandle')).toHaveCount(1);

  const before = await dir.locator("path.apcircle").first().getAttribute("d");
  await page.locator("#f-dial").focus();
  await page.locator("#f-dial").press("Shift+ArrowRight");
  await expect(dir.locator("path.apcircle").first()).not.toHaveAttribute("d", before!);

  // The omni has no front, so it has neither dial nor handle.
  await selectMarker(page, "a2");
  await expect(page.locator("#f-dial")).toHaveCount(0);
  await expect(page.locator('#g-markers .marker[data-id="a2"] .rothandle')).toHaveCount(0);
});

test("hovering a marker shows the card within 300 ms, with label and status", async ({ page }) => {
  await openPlanner(page, { plan: headingPlan });

  const card = page.locator("#hovercard");
  await expect(card).toBeHidden();

  const at = async (id: string) => {
    const b = await page.locator(`#g-markers .marker[data-id="${id}"] .body`).boundingBox();
    return { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 };
  };
  const a1 = await at("a1"),
    a2 = await at("a2"),
    off = { x: a1.x, y: a1.y - 200 };

  // A 150 ms timer can land late when the whole suite runs in parallel, so the
  // fastest of three cold passes is what has to make it — never a single one.
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(off.x, off.y);
    await expect(card).toBeHidden();
    await page.waitForTimeout(600); // the warm window has to run out first
    const t0 = Date.now();
    await page.mouse.move(a1.x, a1.y);
    await expect(card).toBeVisible();
    best = Math.min(best, Date.now() - t0);
  }
  expect(best).toBeLessThan(300);

  // Element label and connection status on top, the product card below.
  await expect(card.locator(".hn").first()).toHaveText("A1");
  await expect(card.locator(".hs")).toHaveCount(1);
  await expect(card).toContainText("U7 Outdoor");

  // Within the warm window, moving on switches the card instead of waiting again.
  const t1 = Date.now();
  await page.mouse.move(a2.x, a2.y);
  await expect(card.locator(".hn").first()).toHaveText("A2");
  expect(Date.now() - t1).toBeLessThan(300);

  // Away from any element the card goes.
  await page.mouse.move(off.x, off.y);
  await expect(card).toBeHidden();
});
