import { expect, test } from "@playwright/test";
import { drawPlan } from "./fixtures";
import { openPlanner, stubOffsite } from "./helpers";

// A conduit isn't a line but layers on offset paths, plus cross-sections in their own
// group. And `migrateConduit()` has to accept all three shapes — old share links depend
// on that. Ported from tools/check.mjs, first jsdom boot.

const cond = (page: import("@playwright/test").Page, id: string) =>
  page.locator(`#g-conduits g.conduit[data-id="${id}"]`);

test.beforeEach(async ({ context, page }) => {
  await stubOffsite(context);
  await openPlanner(page, { plan: drawPlan });
});

test("three layers per conduit: trench, ducts, cables", async ({ page }) => {
  const c4 = cond(page, "c4");
  await expect(c4.locator("path.trench")).toHaveCount(1);
  await expect(c4.locator("path.duct")).toHaveCount(3);
  await expect(c4.locator("path.strand")).toHaveCount(3);

  // Every strand hangs off the duct that its cable is in.
  expect(
    await c4
      .locator("path.strand")
      .evaluateAll((n) => n.map((p) => [p.getAttribute("data-duct"), p.getAttribute("stroke")])),
  ).toEqual([
    ["0", "var(--accent)"],
    ["0", "var(--accent)"],
    ["1", "var(--ink-3)"],
  ]);

  const offs = await c4
    .locator("path.duct")
    .evaluateAll((n) => n.map((p) => Number(p.getAttribute("data-off"))));
  expect(offs[0]).toBeLessThan(offs[1]);
  expect(offs[1]).toBeLessThan(offs[2]);
  // The whole set sits centered on the path, and the duct with two cables gets more space.
  const all = await c4
    .locator("[data-off]")
    .evaluateAll((n) => n.map((p) => Number(p.getAttribute("data-off"))));
  expect(Math.abs(Math.min(...all) + Math.max(...all))).toBeLessThan(1e-6);
  expect(offs[1] - offs[0]).toBeGreaterThan(offs[2] - offs[1]);

  // The parallel really is offset, not the same path as the hit area.
  expect(await c4.locator("path.duct").first().getAttribute("d")).not.toBe(
    await c4.locator("path.core").getAttribute("d"),
  );
});

test("cross-sections sit in their own group, one circle per duct", async ({ page }) => {
  const sec = page.locator('#g-sections g.csection[data-id="c4"]');
  await expect(sec).toHaveCount(1);
  await expect(sec.locator("circle.duct")).toHaveCount(3);
  await expect(sec.locator("circle.cable")).toHaveCount(3);

  const cx = await sec
    .locator("circle.duct")
    .evaluateAll((n) => n.map((c) => Number(c.getAttribute("cx"))));
  expect(cx[0]).toBeLessThan(cx[1]);
  expect(cx[1]).toBeLessThan(cx[2]);
  expect(Math.abs(cx[1])).toBeLessThan(1e-6);
  expect(await sec.getAttribute("transform")).toContain("scale(");
  await expect(sec.locator("title")).toContainText("Glasfaser");

  // Group order: cross-sections above the markers, handles above that.
  const order = await page.locator("#svg > g").evaluateAll((n) => n.map((g) => g.id));
  expect(order.indexOf("g-sections")).toBeGreaterThan(order.indexOf("g-markers"));
  expect(order.indexOf("g-handles")).toBeGreaterThan(order.indexOf("g-sections"));
});

test("no duct means no trench, an empty duct stays dashed", async ({ page }) => {
  const c5 = cond(page, "c5");
  await expect(c5.locator("path.trench")).toHaveCount(0);
  await expect(c5.locator("path.duct")).toHaveCount(0);
  await expect(c5.locator("path.strand")).toHaveCount(1);
  await expect(page.locator('#g-sections g.csection[data-id="c5"] circle.duct')).toHaveCount(0);
  await expect(page.locator('#g-sections g.csection[data-id="c5"] circle.cable')).toHaveCount(1);

  const c2 = cond(page, "c2");
  await expect(c2.locator("path.strand")).toHaveCount(0);
  expect(await c2.locator("path.duct").first().getAttribute("stroke-dasharray")).toBe("8 6");
});

test("cross-sections have their own toggle, independent of the labels", async ({ page }) => {
  const svg = page.locator("#svg");
  await page.locator("#viewBtn").click();
  await page.locator('#showRow [data-show="labels"]').click();
  await expect(svg).toHaveClass(/hide-labels/);
  await expect(svg).not.toHaveClass(/hide-sections/);

  await page.locator('#showRow [data-show="labels"]').click();
  await page.locator('#showRow [data-show="sections"]').click();
  await expect(svg).toHaveClass(/hide-sections/);
  await expect(svg).not.toHaveClass(/hide-labels/);
  await expect(page.locator("#g-sections")).toBeHidden();

  await page.locator('#showRow [data-show="sections"]').click();
  await expect(svg).not.toHaveClass(/hide-sections/);
});

test("migrateConduit() accepts all three shapes", async ({ page }) => {
  // Flat with a ducts count: the cable list moves into duct 1.
  const c1 = cond(page, "c1");
  await expect(c1.locator("path.duct")).toHaveCount(1);
  expect(
    await c1.locator("path.strand").evaluateAll((n) => n.map((p) => p.getAttribute("data-duct"))),
  ).toEqual(["0", "0"]);

  // Very old: template key plus cable count.
  const cold = cond(page, "cold");
  await expect(cold.locator("path.duct")).toHaveCount(1);
  expect(
    await cold.locator("path.strand").evaluateAll((n) => n.map((p) => p.getAttribute("stroke"))),
  ).toEqual(["var(--accent)"]);
  expect(
    await cond(page, "cold2")
      .locator("path.strand")
      .evaluateAll((n) => n.map((p) => p.getAttribute("stroke"))),
  ).toEqual(["var(--accent)", "var(--accent)"]);

  // A trench with two duct types stays one trench.
  const cmix = cond(page, "cmix");
  await expect(cmix.locator("path.trench")).toHaveCount(1);
  await expect(cmix.locator("path.duct")).toHaveCount(2);

  // The old duct type "none" becomes a cable run: no trench, no duct.
  const cbare = cond(page, "cbare");
  await expect(cbare.locator("path.trench")).toHaveCount(0);
  await expect(cbare.locator("path.duct")).toHaveCount(0);
  await expect(cbare.locator("path.strand")).toHaveCount(2);

  // Flat shape with three ducts: each duct inherits the old duct type.
  await expect(cond(page, "c63").locator("path.duct")).toHaveCount(3);
});

test("cross-sections appear when zooming in and disappear again when zooming out", async ({
  page,
}) => {
  const secs = page.locator('#g-sections g.csection[data-id="c4"]');
  await expect(secs).toHaveCount(1);

  for (let i = 0; i < 4; i++) await page.locator("#z-in").click();
  await expect.poll(() => secs.count()).toBeGreaterThanOrEqual(3);
  const xs = (await secs.evaluateAll((n) => n.map((g) => Number(g.getAttribute("data-sx"))))).sort(
    (a, b) => a - b,
  );
  // Symmetric around the middle of the route (110 … 250).
  expect(Math.abs((xs[0] + xs[xs.length - 1]) / 2 - 180)).toBeLessThan(1);

  for (let i = 0; i < 4; i++) await page.locator("#z-out").click();
  await expect.poll(() => secs.count()).toBe(1);
});

test("groups are pure display and pull conduit ends to their center", async ({ page }) => {
  const cl = page.locator("#g-markers .marker.cluster");
  await expect(cl).toHaveCount(1);
  await expect(cl.locator("text")).toHaveText("2");
  await expect(cl.locator(".ring")).toHaveCount(2);

  // A gap remains between two segments — otherwise the colors would bleed into each other.
  const arcs = await cl.locator("path.ring").evaluateAll((n) => n.map((p) => p.getAttribute("d")!));
  const endOf = (d: string) => d.split(/\s+/).slice(-2).map(Number);
  const startOf = (d: string) => d.slice(1).trim().split(/\s+/).slice(0, 2).map(Number);
  expect(Math.hypot(...endOf(arcs[0]).map((v, i) => v - startOf(arcs[1])[i]))).toBeGreaterThan(0.5);

  // Members get no marker of their own, but their field of view still stays put.
  await expect(page.locator('#g-markers .marker[data-id="z1"]')).toHaveCount(0);
  await expect(page.locator('.cone[data-id="z1"]')).toHaveCount(1);

  // A conduit that ends at a group member is drawn all the way to the group's center.
  const d = (await cond(page, "cz").locator("path.core").getAttribute("d"))!;
  const end = d.split("L").pop()!.trim().split(/\s+/).map(Number);
  expect(Math.abs(end[0] - (360 + 365.96) / 2)).toBeLessThan(0.01);
  expect(Math.abs(end[1] - 60)).toBeLessThan(0.01);
  expect(Math.abs(end[0] - 360)).toBeGreaterThan(1);
  const start = d.slice(1).split("L")[0].trim().split(/\s+/).map(Number);
  expect(start).toEqual([300, 260]);

  // Clicking the group zooms in, after which the members stand individually.
  const width = () =>
    page.locator("#svg").evaluate((n) => Number(n.getAttribute("viewBox")!.split(/\s+/)[2]));
  const w0 = await width();
  await cl.locator("circle.body").dispatchEvent("pointerdown", { bubbles: true });
  await expect.poll(width).toBeLessThan(w0);
  await expect(page.locator("#g-markers .marker.cluster")).toHaveCount(0);
  await expect(page.locator('#g-markers .marker[data-id="z1"]')).toHaveCount(1);

  // None of this ends up in the saved plan: no collection node, no membership on the
  // element. Only `look.cluster` is there — that's the toggle, not the group.
  // The planner saves debounced (900 ms); until it does, the key still holds the raw
  // seeded state that migrateLegacy() carried over, and that one has no `look` yet.
  const read = () =>
    page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem(`sl-plan:${localStorage.getItem("sl-current")}`) ?? "{}",
        ) as { items: Record<string, unknown>[]; look: Record<string, unknown> },
    );
  await expect.poll(async () => !!(await read()).look).toBe(true);
  const plan = await read();
  expect(plan.items).toHaveLength(9);
  for (const it of plan.items) {
    expect(Object.keys(it).filter((k) => /cluster|group/i.test(k))).toEqual([]);
  }
  expect(Object.keys(plan).filter((k) => /cluster/i.test(k))).toEqual([]);
  expect(plan.look.cluster).toBe(true);
});

test("symbols stay screen-sized, zooming doesn't redraw", async ({ page }) => {
  const marker = page.locator("#g-markers .marker").first();
  await marker.evaluate((n) => n.setAttribute("data-probe", "x"));
  const scale = () =>
    page
      .locator("#g-markers .marker")
      .first()
      .evaluate((n) => Number(/scale\(([-\d.]+)\)/.exec(n.getAttribute("transform") ?? "")?.[1]));
  const width = () =>
    page.locator("#svg").evaluate((n) => Number(n.getAttribute("viewBox")!.split(/\s+/)[2]));

  const s0 = await scale();
  const w0 = await width();
  const n0 = await page.locator("#g-markers .marker").count();

  await page.locator("#z-out").click();
  expect(await width()).toBeGreaterThan(w0 * 1.3);
  // The same node, just a new scale — the map wasn't redrawn.
  await expect(page.locator("#g-markers .marker").first()).toHaveAttribute("data-probe", "x");
  expect(await scale()).toBeGreaterThan(s0);
  await expect(page.locator("#g-markers .marker")).toHaveCount(n0);
  await expect(page.locator("#g-labels [data-sx]").first()).toBeAttached();

  await page.locator("#z-in").click();
  expect(Math.abs((await scale()) - s0)).toBeLessThan(1e-3);
});
