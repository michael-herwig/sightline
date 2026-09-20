import { expect, test } from "@playwright/test";
import { smallPlan } from "./fixtures";
import { openPane, openPlanner, PANE, savedPlan, stubOffsite, watchErrors } from "./helpers";

// Multiple plans sit individually under `sl-plan:<id>`, the list under `sl-plans`,
// the active one under `sl-current`. The homepage is the gateway there.

test.beforeEach(async ({ context }) => {
  await stubOffsite(context);
});

test("a new plan starts empty and doesn't displace the old one", async ({ page }) => {
  await openPlanner(page, { plan: smallPlan });
  await openPane(page, PANE.list);

  const count = async () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("sl-plans") ?? "[]").length);
  const before = await count();

  await page.locator("#l-new").click();
  await expect(page.locator("#g-markers .marker")).toHaveCount(0);
  await expect.poll(count).toBe(before + 1);

  const fresh = await savedPlan(page);
  expect(fresh.items).toEqual([]);
  expect(fresh.conduits).toEqual([]);
  expect(String(fresh.name ?? "").trim()).toBe("");

  const index = await page.evaluate(() => JSON.parse(localStorage.getItem("sl-plans") ?? "[]"));
  const current = await page.evaluate(() => localStorage.getItem("sl-current"));
  expect(index.find((e: { id: string }) => e.id === current).n).toBe(0);
  expect(
    index.some((e: { id: string; name: string }) => e.id !== current && (e.name ?? "").trim()),
  ).toBe(true);
  // The old single key is resolved.
  expect(await page.evaluate(() => localStorage.getItem("sl-plan"))).toBeNull();
});

test("the plan menu switches and deletes", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await openPlanner(page, { plan: smallPlan });

  await openPane(page, PANE.list);
  await page.locator("#l-new").click();
  await expect(page.locator("#g-markers .marker")).toHaveCount(0);

  // Back to the named plan.
  // The list only builds itself in the `toggle` event.
  await page.locator("#projMenu > summary").click();
  const rows = page.locator("#projList .projrow .pick");
  await expect(rows).toHaveCount(2);
  await rows.filter({ hasText: "Kleinplan" }).first().click();
  await expect(page.locator("#g-markers .marker.cam")).toHaveCount(1);
  await expect(page.locator("#projName")).toHaveValue("Kleinplan");

  // Discard the empty plan again.
  await page.locator("#projMenu > summary").click();
  const before = await page.locator("#projList .projrow").count();
  await page
    .locator("#projList .projrow")
    .filter({ hasNotText: "Kleinplan" })
    .first()
    .locator(".del")
    .click();
  await expect(page.locator("#projList .projrow")).toHaveCount(before - 1);
  await expect(page.locator("#g-markers .marker.cam")).toHaveCount(1);
});

test("the working state survives a reload", async ({ page }) => {
  await openPlanner(page, { plan: smallPlan });
  await openPane(page, PANE.build);
  await page.locator("#cat-q").fill("ptz");
  await expect.poll(async () => (await savedPlan(page)).catQuery).toBeTruthy();

  const saved = await savedPlan(page);
  for (const k of [
    "lang",
    "name",
    "sub",
    "shop",
    "basemap",
    "overlay",
    "view",
    "dock",
    "dockSize",
    "catQuery",
    "catFacets",
    "look",
  ]) {
    expect(saved, `${k} wird gespeichert`).toHaveProperty(k);
  }
  expect((saved.catQuery as Record<string, string>).cam).toBe("ptz");
  expect(Object.keys(saved.show as object).sort()).toEqual([
    "conds",
    "cones",
    "labels",
    "rings",
    "sections",
  ]);
  expect(Object.keys(saved.catQuery as object).sort()).toEqual(["ap", "cam", "cond", "gear", "jb"]);
  // Positions travel as e/n in EPSG:25832, x/y are just the pixel cache for them.
  expect(
    (saved.items as { e: number; n: number }[]).every(
      (i) => Number.isFinite(i.e) && Number.isFinite(i.n),
    ),
  ).toBe(true);
  expect(
    (saved.conduits as { points: { e: number; n: number }[] }[]).every((c) =>
      c.points.every((p) => Number.isFinite(p.e) && Number.isFinite(p.n)),
    ),
  ).toBe(true);
  expect(Number.isFinite((saved.geo as { e0: number }).e0)).toBe(true);

  // Without re-seeding: the planner pulls the state from sl-current.
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => document.querySelectorAll("#dock .dv-tab").length >= 4);
  await expect(page.locator("#projName")).toHaveValue("Kleinplan");
  await expect(page.locator("#g-markers .marker.cam")).toHaveCount(1);
  await openPane(page, PANE.build);
  await expect(page.locator("#cat-q")).toHaveValue("ptz");
});

test("the homepage is the gateway into the planner", async ({ page }) => {
  const errs = watchErrors(page);
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem(
        "sl-plans",
        JSON.stringify([{ id: "pdemo", name: "Listenplan", updated: Date.now(), n: 3 }]),
      );
      localStorage.setItem(
        "sl-plan:pdemo",
        JSON.stringify({
          name: "Listenplan",
          items: [],
          conduits: [],
          view: { x: 0, y: 0, w: 800, h: 800 },
        }),
      );
      localStorage.setItem("sl-current", "pdemo");
    } catch {
      /* private mode */
    }
  });
  await page.goto("/", { waitUntil: "load" });

  await expect(page.locator("#startGeo")).toBeVisible();
  await expect(page.locator("#planFile")).toHaveCount(1);
  await expect(page.locator("#siteLang")).toBeVisible();
  await expect(page.locator('a[href="/help"]')).toHaveCount(1);
  await expect(page.locator('a[href="/planner#new=1"]')).toHaveCount(1);

  // The list shows the existing plan and hands it over by its id.
  await expect(page.locator("#resumeCard")).toBeVisible();
  const link = page.locator("#planList a").first();
  await expect(link).toHaveText("Listenplan");
  await expect(link).toHaveAttribute("href", "/planner#o=pdemo");
  await link.click();
  await page.waitForFunction(() => document.querySelectorAll("#dock .dv-tab").length >= 4);
  await expect(page.locator("#projName")).toHaveValue("Listenplan");
  expect(await page.evaluate(() => localStorage.getItem("sl-current"))).toBe("pdemo");

  expect(errs, errs.join(" | ")).toEqual([]);
});

test("homepage and planner share the language key", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
  await expect(page.locator("#siteLang")).toHaveText("DE");
  await page.locator("#siteLang").click();
  await expect(page.locator("#siteLang")).toHaveText("EN");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await page.evaluate(() => localStorage.getItem("sl-lang"))).toBe("en");

  await page.goto("/planner#new=1", { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelectorAll("#dock .dv-tab").length >= 4);
  await expect(page.locator("#t-lang")).toHaveText("EN");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("/help explains the planner in both languages", async ({ page }) => {
  const errs = watchErrors(page);
  await page.goto("/help", { waitUntil: "load" });

  await expect(page.locator("#siteLang")).toBeVisible();
  await expect(page.locator("body")).toContainText("Glasfaser wird am Abzweig nicht geteilt");
  // The explanations come from the script, not from the markup.
  await expect(page.locator('[data-i18n="d.v"]')).not.toHaveText("—");
  await expect(page.locator('[data-i18n-html="p.2"]')).toContainText("Glasfaser");
  await expect(page.locator('[data-i18n-html="p.mains"]')).toContainText("230 V");

  await page.locator("#siteLang").click();
  await expect(page.locator("body")).toContainText("Fibre is not split at a branch");
  await expect(page.locator("body")).toContainText("need 230 V on the spot");
  expect(errs, errs.join(" | ")).toEqual([]);
});

test("/404 leads back to the homepage", async ({ page }) => {
  const res = await page.goto("/gibt-es-nicht", { waitUntil: "load" });
  expect(res?.status()).toBe(404);
  // Scope to `main`: the Astro dev toolbar brings its own h1 along.
  await expect(page.locator("main h1")).toHaveText("Seite nicht gefunden");
  await expect(page.locator('main a[href="/"]')).toHaveCount(1);
  await page.locator("#siteLang").click();
  await expect(page.locator("main h1")).toHaveText("Page not found");
});
