import { expect, test, type Page } from "@playwright/test";
import { linkPlan } from "./fixtures";
import { openPlanner, stubOffsite, toggleSwitch } from "./helpers";

// Export: dialog, image, PDF, print sheet, Markdown, plan file. Blobs are recorded via
// URL.createObjectURL — so the test doesn't depend on the download path.

interface Recorded {
  type: string;
  size: number;
}

async function recordBlobs(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __blobs: Recorded[]; print: () => void };
    w.__blobs = [];
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      if (obj instanceof Blob) w.__blobs.push({ type: obj.type, size: obj.size });
      return orig(obj);
    };
    // window.print() opens a dialog in Chromium; the sheet itself can still be
    // checked regardless.
    w.print = () => {};
  });
}

const blobs = (page: Page) =>
  page.evaluate(() => (window as unknown as { __blobs: Recorded[] }).__blobs);

const clipText = (page: Page) =>
  page.evaluate(() => (window as unknown as { __clip: { text: string } }).__clip.text);

test.beforeEach(async ({ context, page }) => {
  await stubOffsite(context);
  await recordBlobs(page);
  await openPlanner(page, { plan: linkPlan, stubClipboard: true });
});

test("the export dialog opens and closes again", async ({ page }) => {
  await page.locator("#t-export").click();
  await expect(page.locator("#expDlg")).toHaveAttribute("open", "");
  await expect(page.locator('#exp-area [data-area="view"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator('#exp-area [data-area="all"]').click();
  await expect(page.locator('#exp-area [data-area="all"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('#exp-area [data-area="view"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.locator("#expClose").click();
  await expect(page.locator("#expDlg")).not.toHaveAttribute("open", /.*/);
});

test("image export delivers a non-empty PNG", async ({ page }) => {
  await page.locator("#t-export").click();
  const download = page.waitForEvent("download");
  await page.locator("#exp-dl").click();

  await expect
    .poll(
      async () => (await blobs(page)).filter((b) => b.type === "image/png" && b.size > 0).length,
      {
        timeout: 30_000,
      },
    )
    .toBeGreaterThan(0);
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.png$/);
});

test("PDF export delivers a blob", async ({ page }) => {
  await page.locator("#t-export").click();
  await toggleSwitch(page, "exp-p-links");
  await expect(page.locator("#exp-p-links")).toBeChecked();
  const download = page.waitForEvent("download");
  await page.locator("#exp-pdfdl").click();

  await expect
    .poll(
      async () =>
        (await blobs(page)).filter((b) => b.type === "application/pdf" && b.size > 0).length,
      {
        timeout: 30_000,
      },
    )
    .toBeGreaterThan(0);
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
});

test("the print sheet carries the connection findings and product links", async ({ page }) => {
  await page.locator("#t-export").click();
  await toggleSwitch(page, "exp-p-links");
  await expect(page.locator("#exp-p-links")).toBeChecked();
  await page.locator("#exp-pdf").click();

  const sheet = page.locator("#printsheet");
  await expect(sheet).toHaveCount(1);
  await expect(sheet.locator("ul.links")).toContainText("https://www.amazon.de/dp/");
  await expect(sheet).toContainText("via S1 · 40 m");
  await expect(sheet).toContainText("⚠ Kein Kabel bis hierher");
  await expect(sheet.locator(".sheetmap svg")).toHaveCount(1);
});

test("Markdown lists conduits, connections, and product links", async ({ page }) => {
  await page.locator("#t-export").click();
  await page.locator("#exp-md").click();

  await expect.poll(() => clipText(page)).not.toBe("");
  const md = await clipText(page);

  expect(md).toContain("## Anschlüsse");
  expect(md).toContain("Versorgt über S1");
  expect(md).toMatch(/\*\*S1\*\*: /);
  expect(md).toContain("K2: Kein Kabel bis hierher");
  // Conduit names and lengths — the length is already given in meters.
  expect(md).toMatch(/\| Kupfer \| S1 \| K1 \| 40 m \|/);
  expect(md).toContain("| Faser |");
  expect(md).toContain("## Produktlinks");
  expect(md).toMatch(/· Amazon: https:\/\/www\.amazon\.de\/dp\/[A-Z0-9]{10}/);
});

test("bill of materials and plan file go out via the same paths", async ({ page }) => {
  await page.locator("#t-export").click();
  await page.locator("#exp-bom").click();
  await expect.poll(() => clipText(page)).toContain("USW Flex");

  const download = page.waitForEvent("download");
  await page.locator("#exp-json").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.json$/);
  expect((await blobs(page)).some((b) => b.type === "application/json" && b.size > 0)).toBe(true);
});
