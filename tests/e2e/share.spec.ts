import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { smallPlan } from "./fixtures";
import { openPane, openPlanner, PANE, stubOffsite, watchErrors } from "./helpers";

// The share link is `#p=<1|2><base64url>`. It carries the whole plan and wins
// over localStorage and the server at boot.

test.beforeEach(async ({ context }) => {
  await stubOffsite(context);
});

test("sharing puts the plan into the link and a fresh context reads it back", async ({
  page,
  browser,
}) => {
  await openPlanner(page, { plan: smallPlan, stubClipboard: true });

  await page.locator("#projName").fill("Testhof");
  await page.locator("#projName").press("Enter");
  await expect(page).toHaveTitle(/^Testhof/);

  await page.locator("#t-share").click();
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#p=[12]/);
  const hash = await page.evaluate(() => location.hash);
  // The clipboard gets the whole address, not just the hash.
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __clip: { text: string } }).__clip.text),
    )
    .toContain(hash);

  const ctx = await browser.newContext();
  await stubOffsite(ctx);
  const fresh = await ctx.newPage();
  const errs = watchErrors(fresh);
  await openPlanner(fresh, { hash });

  await expect(fresh.locator("#projName")).toHaveValue("Testhof");
  await expect(fresh.locator("#g-markers .marker.cam")).toHaveCount(1);
  await expect(fresh.locator("#g-markers .marker.hub")).toHaveCount(1);
  await expect(fresh.locator("#g-conduits g.conduit")).toHaveCount(1);
  await openPane(fresh, PANE.list);
  await expect(fresh.locator("#l-conds .lrow")).toContainText("Kupfer");
  // The link becomes its own plan and doesn't overwrite a foreign one.
  await expect.poll(() => fresh.evaluate(() => location.hash)).toBe("");
  expect(errs, errs.join(" | ")).toEqual([]);
  await ctx.close();
});

test("a recorded link from today's build opens unchanged", async ({ page }) => {
  const hash = readFileSync(new URL("./fixtures/share-v1.txt", import.meta.url), "utf8").trim();
  expect(hash).toMatch(/^#p=[12]/);

  const errs = watchErrors(page);
  await openPlanner(page, { hash });

  await expect(page.locator("#projName")).toHaveValue("Kleinplan");
  await expect(page.locator("#g-markers .marker.cam")).toHaveCount(1);
  await expect(page.locator("#g-markers .marker.hub")).toHaveCount(1);
  await expect(page.locator("#g-conduits g.conduit")).toHaveCount(1);
  await openPane(page, PANE.list);
  await expect(page.locator("#l-cams .lrow .b")).toHaveText("K1");
  await expect(page.locator("#l-conds .lrow")).toContainText("Kupfer");
  expect(errs, errs.join(" | ")).toEqual([]);
});

test("a broken link falls back silently to an empty plan", async ({ page }) => {
  const errs = watchErrors(page);
  await openPlanner(page, { hash: "#p=2nichtsdavonistbase64url!!!" });

  await expect(page.locator("#g-markers .marker")).toHaveCount(0);
  expect(errs, errs.join(" | ")).toEqual([]);
});
