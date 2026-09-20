import { expect, test, type Page } from "@playwright/test";
import { stubOffsite, watchErrors } from "./helpers";

// The website around the planner: address search, the plan list, the language
// toggle and the one-time oh- → sl- key migration. What happens inside /planner
// is covered by the other specs.

test.beforeEach(async ({ context }) => {
  await stubOffsite(context);
});

/** localStorage as the planner would have left it, seeded before the first load. */
async function seed(page: Page, entries: Record<string, string>) {
  await page.addInitScript((kv: Record<string, string>) => {
    try {
      localStorage.clear();
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  }, entries);
}

/**
 * Answer /planner with a blank page. The planner clears the hash on boot, so
 * this is the only way to see what the landing page actually handed over.
 */
async function stubPlanner(page: Page) {
  await page.route("**/planner", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>stub</title>" }),
  );
}

const plan = (name: string) =>
  JSON.stringify({ name, items: [], conduits: [], view: { x: 0, y: 0, w: 800, h: 800 } });

test("the address search hands a hit to the planner", async ({ page }) => {
  const errs = watchErrors(page);
  await stubPlanner(page);
  await page.goto("/", { waitUntil: "load" });

  await page.locator("#addr").fill("Musterstraße 1");
  const hit = page.locator("#geoList button").first();
  await expect(hit).toBeVisible(); // debounced by 450 ms, so this is the wait
  await expect(hit).toContainText("Musterstraße 1");
  // The service belongs to someone else, so it gets named under the hits.
  await expect(page.locator("#geoList .cred")).toContainText("Nominatim");

  await hit.click();
  await page.waitForURL(/\/planner#/);
  expect(page.url()).toContain("#new=1&ll=50.941357,6.958307&n=");
  expect(errs, errs.join(" | ")).toEqual([]);
});

test("submitting without picking a hit carries the query over", async ({ page }) => {
  await stubPlanner(page);
  await page.goto("/", { waitUntil: "load" });
  await page.locator("#addr").fill("Musterdorf");
  await page.locator("#startGeo button[type=submit]").click();
  await page.waitForURL(/\/planner#/);
  expect(page.url()).toContain("#new=1&q=Musterdorf");
});

test("the plan list deletes a plan without touching the others", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await seed(page, {
    "sl-plans": JSON.stringify([
      { id: "pa", name: "Plan A", updated: Date.now(), n: 2 },
      { id: "pb", name: "Plan B", updated: Date.now() - 1000, n: 5 },
    ]),
    "sl-plan:pa": plan("Plan A"),
    "sl-plan:pb": plan("Plan B"),
    "sl-current": "pa",
  });
  await page.goto("/", { waitUntil: "load" });

  const rows = page.locator("#planList tr");
  await expect(rows).toHaveCount(2);
  await rows.filter({ hasText: "Plan A" }).locator(".del").click();

  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Plan B");
  // The plan itself and the pointer to it are gone, the other one is untouched.
  expect(await page.evaluate(() => localStorage.getItem("sl-plan:pa"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("sl-current"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("sl-plan:pb"))).not.toBeNull();
});

test("plans saved under the old oh- prefix survive", async ({ page }) => {
  await seed(page, {
    "oh-plans": JSON.stringify([{ id: "pold", name: "Altplan", updated: Date.now(), n: 1 }]),
    "oh-plan:pold": plan("Altplan"),
    "oh-current": "pold",
    "oh-lang": "en",
  });
  await page.goto("/", { waitUntil: "load" });

  await expect(page.locator("#planList a").first()).toHaveText("Altplan");
  await expect(page.locator("#siteLang")).toHaveText("EN");
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.filter((k) => k.startsWith("oh-"))).toEqual([]);
  expect(keys).toContain("sl-plan:pold");
});

test("the language carries from the landing page to the guide and the 404", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
  await page.locator("#siteLang").click();
  await expect(page.locator("main h1")).toHaveText("Cameras, Wi-Fi and conduits on one sheet.");

  await page.goto("/help", { waitUntil: "load" });
  await expect(page.locator("#siteLang")).toHaveText("EN");
  await expect(page.locator("main h1")).toHaveText("Guide");
  await expect(page).toHaveTitle(/^Guide/);

  await page.goto("/nichts-da", { waitUntil: "load" });
  await expect(page.locator("main h1")).toHaveText("Page not found");
  await expect(page).toHaveTitle("Page not found");
});
