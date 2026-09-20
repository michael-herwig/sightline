import { expect, test } from "@playwright/test";
import { legacyPlan, linkPlan, powerPlan } from "./fixtures";
import {
  linkText,
  listRow,
  openPane,
  openPlanner,
  PANE,
  ring,
  selectMarker,
  stubOffsite,
  watchErrors,
} from "./helpers";

// Ported from the second and third jsdom boot in tools/check.mjs (lines 1204–1923):
// every finding that links() knows, plus the rings it sets on the map.

test.beforeEach(async ({ context }) => {
  await stubOffsite(context);
});

/** Select a junction or camera via the elements list. */
async function pick(page: import("@playwright/test").Page, list: string, label: string) {
  await openPane(page, PANE.list);
  await listRow(page, list, label).first().click();
}

test.describe("Topology", () => {
  test.beforeEach(async ({ page }) => {
    await openPlanner(page, { plan: linkPlan });
  });

  test("ok: camera on the switch names source, distance, and conduit", async ({ page }) => {
    await pick(page, "l-cams", "K1");
    await expect(linkText(page)).toContainText("Versorgt über S1");
    await expect(linkText(page)).toContainText("40 m Cat6A");
    await expect(linkText(page)).toContainText("Kupfer");
    await expect(ring(page, "k1")).toHaveCount(0);
  });

  test("long: over 90 m of Cat6A overrides the ok finding and warns", async ({ page }) => {
    await pick(page, "l-cams", "KL");
    // The long distance is the finding, not an addition to "Versorgt über …".
    await expect(linkText(page)).toContainText(
      "110 m Cat6A — über 90 m, Glasfaser oder Switch dazwischen",
    );
    await expect(linkText(page)).not.toContainText("Versorgt über");
    await expect(ring(page, "kl", "warn")).toHaveCount(1);
    await expect(ring(page, "kl", "err")).toHaveCount(0);
  });

  test("none: no cable means a red ring and a finding", async ({ page }) => {
    await pick(page, "l-cams", "K2");
    await expect(linkText(page)).toContainText("Kein Kabel bis hierher");
    await expect(ring(page, "k2", "err")).toHaveCount(1);
    await expect(listRow(page, "l-cams", "K2").locator(".st.err")).toHaveCount(1);
  });

  test("nopoe: the media converter doesn't supply power", async ({ page }) => {
    await pick(page, "l-cams", "K9");
    await expect(linkText(page)).toContainText("liefert kein PoE");
  });

  test("WiFi camera needs no cable at all", async ({ page }) => {
    await pick(page, "l-cams", "K3");
    await expect(linkText(page)).not.toContainText("Kein Kabel bis hierher");
    await expect(ring(page, "k3")).toHaveCount(0);
  });

  test("fiber: fiber directly at the camera is an error", async ({ page }) => {
    await pick(page, "l-cams", "KF");
    await expect(linkText(page)).toContainText("Glasfaser endet am Gerät");
    await expect(ring(page, "kf", "err")).toHaveCount(1);
  });

  test("deadup: connected is not supplied", async ({ page }) => {
    await pick(page, "l-cams", "K4");
    await expect(linkText(page)).toContainText("Versorgt über S4, aber S4 hat keinen Uplink");
    await expect(ring(page, "k4", "err")).toHaveCount(1);
    // Each one reports its own part: the source itself only gets a warning.
    await expect(ring(page, "s4", "warn")).toHaveCount(1);
  });

  test("dead: the cable ends at an empty point", async ({ page }) => {
    await expect(ring(page, "j6", "err")).toHaveCount(0);
    await expect(ring(page, "j6", "warn")).toHaveCount(1);
    await expect(page.locator('#g-markers .marker[data-id="j6"].active')).toHaveCount(0);
    await pick(page, "l-jbs", "J6");
    await expect(linkText(page)).toContainText(
      "1 × Glasfaser SM, 4 Fasern enden an J6 ohne Gegenstück",
    );
    await pick(page, "l-cams", "K6");
    await expect(listRow(page, "l-cams", "K6").locator(".t small")).toContainText(
      "Kabel endet an J6",
    );
    await expect(listRow(page, "l-cams", "K6").locator(".t small")).not.toContainText(
      "Kein Kabel bis hierher",
    );
  });

  test("bal: without a splice box a warning, with one none", async ({ page }) => {
    await pick(page, "l-jbs", "J7");
    await expect(linkText(page)).not.toContainText("ohne Gegenstück");
    await expect(ring(page, "j7")).toHaveCount(0);
  });

  test("switch: uplink, PoE budget, and occupied ports", async ({ page }) => {
    await pick(page, "l-jbs", "S1");
    await expect(linkText(page)).toContainText("Uplink über H1");
    await expect(linkText(page)).toContainText("Glasfaser");
    // K1 and KL each draw 15.4 W, the cascaded switch nothing.
    await expect(linkText(page)).toContainText("30,8 von 196 W");
    await expect(linkText(page)).toContainText("3 von 8 belegt");
    await expect(linkText(page)).toContainText("K1");
    await expect(linkText(page)).toContainText("S7");
    await expect(page.locator("#pane-sel")).toContainText("USW Flex");
    await expect(page.locator("#f-gears .cabrow")).toHaveCount(1);
  });

  test("nosfp: fiber at a switch without an SFP port", async ({ page }) => {
    await pick(page, "l-jbs", "S3");
    await expect(linkText(page)).toContainText("kein SFP-Port");
    await expect(ring(page, "s3", "err")).toHaveCount(1);
  });

  test("uplink.none: two switches that only hang off each other", async ({ page }) => {
    for (const label of ["S4", "S5"]) {
      await pick(page, "l-jbs", label);
      await expect(linkText(page)).toContainText("Kein Uplink");
      await expect(ring(page, label.toLowerCase(), "warn")).toHaveCount(1);
    }
    // A passive shaft doesn't convert the fiber to copper.
    await pick(page, "l-jbs", "S8");
    await expect(linkText(page)).toContainText("Kein Uplink");
  });

  test("ports: the fiber uplink occupies none, the copper uplink does", async ({ page }) => {
    await pick(page, "l-jbs", "C1");
    await expect(linkText(page)).toContainText("Uplink über H1");
    await expect(linkText(page)).toContainText("1 von 1 belegt");
    await pick(page, "l-jbs", "S7");
    await expect(linkText(page)).toContainText("Uplink über H1");
    await expect(linkText(page)).toContainText("1 von 8 belegt");
  });

  test("two devices in the box: budget and ports get summed up", async ({ page }) => {
    await pick(page, "l-jbs", "J5");
    await expect(linkText(page)).toContainText("Uplink über H1");
    await expect(linkText(page)).toContainText("15,4 von 52 W");
    await expect(linkText(page)).toContainText("1 von 8 belegt");
    await expect(page.locator("#pane-sel")).toContainText("USW Ultra");
    await expect(page.locator("#f-gears .cabrow")).toHaveCount(2);
    await expect(page.locator('#g-markers .marker[data-id="j5"].active')).toHaveCount(1);
  });

  test("sfpcount: fiber count against the SFP slots", async ({ page }) => {
    await pick(page, "l-jbs", "S9");
    await expect(linkText(page)).not.toContainText("Faserkabel auf");
    await pick(page, "l-jbs", "S1");
    await expect(linkText(page)).toContainText("2 Faserkabel auf 1 SFP");
    // The fiber to the camera doesn't occupy a slot on the converter.
    await pick(page, "l-jbs", "C1");
    await expect(linkText(page)).not.toContainText("Faserkabel auf");
  });

  test("hub: router, ports, PoE, and SFP balance", async ({ page }) => {
    await selectMarker(page, "h1");
    await expect(page.locator("#f-router")).toHaveValue("ucg");
    await expect(page.locator("#pane-sel .product")).toHaveCount(0);
    await expect(page.locator("#f-gears .cabrow")).toHaveCount(0);
    await expect(linkText(page)).toContainText("UniFi Cloud Gateway Fiber");
    await expect(linkText(page)).toContainText("15,4 von 30 W");
    await expect(linkText(page)).toContainText("1 von 4 belegt");
    await expect(linkText(page)).toContainText("5 Faserkabel auf 1 SFP");
    await expect(ring(page, "h1", "warn")).toHaveCount(1);
    await pick(page, "l-cams", "KH");
    await expect(linkText(page)).toContainText("Versorgt über H1");
  });

  test("nosfp and nopoe at the hub: FRITZ!Box", async ({ page }) => {
    await selectMarker(page, "h1");
    await page.locator("#f-router").selectOption("fb7690");
    await expect(linkText(page)).toContainText("kein SFP-Port");
    await expect(page.locator("#f-hub-advice")).toContainText("kein SFP-Port");
    await expect(ring(page, "h1", "err")).toHaveCount(1);
    await pick(page, "l-cams", "KH");
    await expect(linkText(page)).toContainText("liefert kein PoE");
  });

  test("norouter: without a router the hub is just a cable point", async ({ page }) => {
    await selectMarker(page, "h1");
    await page.locator("#f-router").selectOption("");
    await expect(linkText(page)).toContainText("Kein Router in der Zentrale");
    await pick(page, "l-cams", "KH");
    await expect(linkText(page)).toContainText("Kabel endet an H1");
    await selectMarker(page, "h1");
    await expect(page.locator("#f-hub-advice")).toContainText("Noch kein Router");
    await page.locator("#f-router").selectOption("ucg");
    await expect(linkText(page)).toContainText("UniFi Cloud Gateway Fiber");
  });

  test("every mutation updates finding and ring, undo reverts both", async ({ page }) => {
    await pick(page, "l-jbs", "S1");
    await page.locator("#f-gearx-0").click();
    await pick(page, "l-cams", "K1");
    await expect(linkText(page)).toContainText("Versorgt über S7, aber S7 hat keinen Uplink");
    await expect(ring(page, "k1", "err")).toHaveCount(1);
    await page.keyboard.press("Control+z");
    await pick(page, "l-cams", "K1");
    await expect(linkText(page)).toContainText("Versorgt über S1");
    await expect(ring(page, "k1")).toHaveCount(0);

    // Removing the cable from the conduit: then nothing leads there anymore.
    await openPane(page, PANE.list);
    await page
      .locator("#l-conds .lrow")
      .filter({ has: page.locator(".t", { hasText: /^Kupfer/ }) })
      .first()
      .click();
    await page.locator("#f-cabx-0-0").click();
    await pick(page, "l-cams", "K1");
    await expect(linkText(page)).toContainText("Kein Kabel bis hierher");
    await page.keyboard.press("Control+z");
    await pick(page, "l-cams", "K1");
    await expect(linkText(page)).toContainText("Versorgt über S1");

    // Deleting the point: the cable stays in place, the source is gone.
    await pick(page, "l-jbs", "S1");
    await page.locator("#pane-sel .selhead #f-del").click();
    await pick(page, "l-cams", "K1");
    await expect(linkText(page)).toContainText("Kabel endet an");
    await page.keyboard.press("Control+z");
    await pick(page, "l-cams", "K1");
    await expect(linkText(page)).toContainText("Versorgt über S1");
  });

  test("recommendations change nothing, they only say something", async ({ page }) => {
    await pick(page, "l-jbs", "J5");
    const adv = page.locator("#f-jb-advice");
    await expect(adv).toBeVisible();
    await expect(adv).toContainText("TL-SG2210MP (Switch) (150 €)");
    await expect(adv).toContainText("150 W PoE");
    await expect(adv).toContainText("144 €");
    await expect(page.locator("#f-gears .cabrow")).toHaveCount(2);
    // A point that accepts the fiber itself gets no sentence.
    await pick(page, "l-jbs", "S8");
    await expect(page.locator("#f-jb-advice")).toBeHidden();
  });

  test("cost panel collects the findings", async ({ page }) => {
    await openPane(page, PANE.cost);
    await expect(page.locator("#c-warn")).toContainText("ohne sauberen Anschluss");
  });

  test("the elements list names the source instead of a dash", async ({ page }) => {
    await openPane(page, PANE.list);
    await expect(listRow(page, "l-cams", "K1").locator(".t small")).toHaveText(
      "über S1 · 40 m Cat6A",
    );
    await expect(listRow(page, "l-cams", "K2").locator(".t small")).toContainText(
      "Kein Kabel bis hierher",
    );
    await expect(listRow(page, "l-cams", "K9").locator(".t small")).toContainText(
      "liefert kein PoE",
    );
  });
});

test.describe("Passing fiber on and power at the point", () => {
  test.beforeEach(async ({ page }) => {
    await openPlanner(page, { plan: powerPlan });
  });

  test("a device with multiple SFP slots is a fiber source", async ({ page }) => {
    await pick(page, "l-jbs", "F1");
    await expect(linkText(page)).toContainText("Uplink über H1");
    await expect(linkText(page)).not.toContainText("SFP-Schacht");
    await expect(ring(page, "f1")).toHaveCount(0);
    for (const label of ["F2", "F3"]) {
      await pick(page, "l-jbs", label);
      await expect(linkText(page)).toContainText("Uplink über H1");
      await expect(linkText(page)).toContainText("Glasfaser");
      await expect(ring(page, label.toLowerCase())).toHaveCount(0);
    }
  });

  test("sfpcount: more fibers than slots, the branches stay on the network", async ({ page }) => {
    await pick(page, "l-jbs", "G1");
    await expect(linkText(page)).toContainText("3 Faserkabel auf 2 SFP");
    await expect(ring(page, "g1", "warn")).toHaveCount(1);
    await pick(page, "l-jbs", "G2");
    await expect(linkText(page)).toContainText("Uplink über H1");
  });

  test("mains: 230 V at the point", async ({ page }) => {
    await pick(page, "l-jbs", "M1");
    await expect(linkText(page)).toContainText("M1: Medienkonverter");
    await expect(linkText(page)).toContainText("braucht 230 V");
    await expect(ring(page, "m1", "warn")).toHaveCount(1);

    await pick(page, "l-jbs", "M2");
    await expect(linkText(page)).not.toContainText("braucht 230 V");
    await expect(ring(page, "m2")).toHaveCount(0);
    await expect(page.locator("#f-jb-advice")).toBeHidden();

    await pick(page, "l-jbs", "M3");
    await expect(linkText(page)).not.toContainText("braucht 230 V");

    await pick(page, "l-jbs", "P1");
    await expect(linkText(page)).not.toContainText("braucht 230 V");
    await expect(ring(page, "p1")).toHaveCount(0);
  });

  test("a PoE-fed switch loads the feeder's budget and ports", async ({ page }) => {
    await pick(page, "l-jbs", "F2");
    await expect(linkText(page)).toContainText("15 von 196 W");
    await expect(linkText(page)).toContainText("5 von 8 belegt");
  });

  test("recommendation at the shaft: PoE-fed counterpart instead of a power supply", async ({
    page,
  }) => {
    await pick(page, "l-jbs", "A1");
    await expect(linkText(page)).toContainText("braucht 230 V");
    const adv = page.locator("#f-jb-advice");
    await expect(adv).toBeVisible();
    await expect(adv).toContainText("USW Flex (Switch, außentauglich) (89 €)");
    await expect(adv).toContainText("46 W");
  });
});

test("old states get migrated and recalculated on import", async ({ page }) => {
  const errs = watchErrors(page);
  await openPlanner(page, { plan: linkPlan });

  await expect(page.locator("#g-markers circle.alert").first()).toBeAttached();
  await openPane(page, PANE.list);
  await page.locator("#l-new").click();
  await expect(page.locator("#g-markers .marker")).toHaveCount(0);
  await expect(page.locator("#g-markers circle.alert")).toHaveCount(0);

  await page.locator("#t-file").setInputFiles({
    name: "altplan.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(legacyPlan)),
  });
  await expect(page.locator("#g-markers .marker")).toHaveCount(3);

  await selectMarker(page, "h1");
  await expect(page.locator("#f-gears .cabrow")).toHaveCount(0);
  await expect(linkText(page)).toContainText("UniFi Cloud Gateway Fiber");
  await openPane(page, PANE.list);
  await listRow(page, "l-cams", "K").first().click();
  await expect(linkText(page)).toContainText("Versorgt über S");
  // migrateJb(): the switch point becomes a location + device inside it.
  await openPane(page, PANE.list);
  await listRow(page, "l-jbs", "S").first().click();
  await expect(page.locator("#f-model")).toHaveValue("indoor");
  await expect(page.locator("#f-gears .cabrow")).toHaveCount(1);

  expect(errs, errs.join(" | ")).toEqual([]);
});
