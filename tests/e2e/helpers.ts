import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { nominatimHits, type Plan } from "./fixtures";

// A 1×1 PNG answers everything external (WMS tiles, product images). Without it the
// suite would depend on the network — and every failed resource would show up as a
// console error in boot.spec. Also for FORMAT=image/jpeg: the planner doesn't check
// the type, it just attaches the blob to the <image>.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8//8/AwAFAAH/P98lAAAAAElFTkSuQmCC",
  "base64",
);

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Everything that doesn't come from the dev server gets answered here: WMS tiles and
 * product images as a 1×1 pixel, Nominatim from canned data.
 */
export async function stubOffsite(context: BrowserContext): Promise<void> {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (LOCAL.has(url.hostname)) return route.continue();
    const cors = { "access-control-allow-origin": "*", "cache-control": "no-store" };
    if (url.hostname.endsWith("nominatim.openstreetmap.org")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify(nominatimHits),
      });
    }
    return route.fulfill({ status: 200, contentType: "image/png", headers: cors, body: PNG_1PX });
  });
}

/** Collects console errors and unhandled exceptions from the page. */
export function watchErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push(`console: ${m.text()}`);
  });
  return errs;
}

export interface OpenOpts {
  /** Plan stored under the legacy key `sl-plan` before loading. */
  plan?: Plan | null;
  /** Hash appended to `/planner`, e.g. `#new=1` or a share link. */
  hash?: string;
  lang?: "de" | "en";
  /** Additional localStorage entries, e.g. a ready-made plan list. */
  storage?: Record<string, string>;
  /** Replace navigator.clipboard with a stub (window.__clip). */
  stubClipboard?: boolean;
  /**
   * Wait for markers to be drawn. Default: yes, if the plan brings along elements.
   * boot() only loads the plan after the layout — without this gate a test would
   * click on a map that's still empty.
   */
  expectMarkers?: boolean;
}

/**
 * Seeds localStorage, boots the planner, and waits until dockview is settled.
 * Replaces the `beforeParse` of the jsdom boots from tools/check.mjs.
 */
export async function openPlanner(page: Page, opts: OpenOpts = {}): Promise<void> {
  await page.addInitScript(
    ({ plan, lang, storage, stubClipboard }) => {
      try {
        // Only seed on the first load. addInitScript also runs after a reload —
        // otherwise it would delete exactly the state the reload test is meant to check.
        if (!sessionStorage.getItem("__seeded")) {
          sessionStorage.setItem("__seeded", "1");
          localStorage.clear();
          if (plan) localStorage.setItem("sl-plan", JSON.stringify(plan));
          if (lang) localStorage.setItem("sl-lang", lang);
          for (const [k, v] of Object.entries(storage ?? {})) localStorage.setItem(k, v);
        }
      } catch {
        /* private mode: then just go without a default */
      }
      if (stubClipboard) {
        const clip = { text: "" as string, items: 0 };
        (window as unknown as { __clip: typeof clip }).__clip = clip;
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: (s: string) => {
              clip.text = String(s);
              return Promise.resolve();
            },
            write: (items: unknown[]) => {
              clip.items += items.length;
              return Promise.resolve();
            },
            readText: () => Promise.resolve(clip.text),
          },
        });
      }
    },
    {
      plan: opts.plan ?? null,
      lang: opts.lang ?? null,
      storage: opts.storage ?? {},
      stubClipboard: !!opts.stubClipboard,
    },
  );
  const items = (opts.plan as { items?: unknown[] } | null | undefined)?.items?.length ?? 0;
  await page.goto(`/planner${opts.hash ?? ""}`, { waitUntil: "load" });
  await waitForDock(page, opts.expectMarkers ?? items > 0);
}

/**
 * dockview loads in as its own script; before that there's neither a surface nor
 * tabs. After that dockview lays out the panels, the ResizeObserver calls
 * applyView(), and `syncAspect` follows up on the viewBox. Anyone converting map
 * units to screen coordinates before that misses the click — so wait for a settled
 * viewBox.
 */
export async function waitForDock(page: Page, expectMarkers = false): Promise<void> {
  await page.waitForFunction(
    () =>
      !!document.querySelector("#dock .dv-dockview") &&
      document.querySelectorAll("#dock .dv-tab").length >= 4,
  );
  // initLayout() waits for the first real measurement of `#dock`, so the map comes up
  // at its full width. Assert it rather than trust it: at width 0 dockview clamps every
  // group to 100 px for good, and every coordinate below would be off.
  expect(await page.locator("#mapwrap").evaluate((n) => n.clientWidth)).toBeGreaterThan(300);
  if (expectMarkers) {
    await page.waitForFunction(() => document.querySelectorAll("#g-markers .marker").length > 0);
  }
  // Settled means: viewBox, marker count, and group count don't change for 600 ms.
  // `clusterLater()` recomputes the groups debounced after zooming — anyone who only
  // waits for the viewBox would still click a group marker instead of the camera.
  // Time-based, not a number of iterations: under load the planner's timers run
  // slower, and a fixed iteration window would then be too short.
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __calm?: string; __calmT?: number };
      const vb = document.getElementById("svg")?.getAttribute("viewBox") ?? "";
      if (!vb) return false;
      const sig = [
        vb,
        document.querySelectorAll("#g-markers .marker").length,
        document.querySelectorAll("#g-markers .marker.cluster").length,
      ].join("|");
      const now = Date.now();
      if (sig !== w.__calm) {
        w.__calm = sig;
        w.__calmT = now;
        return false;
      }
      return now - (w.__calmT ?? now) > 600;
    },
    undefined,
    { polling: 50 },
  );
}

/**
 * Activate a panel — via the view menu, just like a user would. dockview unmounts
 * inactive panels from the document, otherwise `#pane-list` would simply be null.
 */
export async function openPane(page: Page, label: RegExp): Promise<void> {
  await page.locator("#viewMenu > summary").click();
  await page.locator("#viewList button").filter({ hasText: label }).first().click();
  await expect(page.locator("#viewMenu")).not.toHaveAttribute("open", /.*/);
}

export const PANE = {
  list: /Elemente|Elements/,
  build: /Bauen|Build/,
  cost: /Kosten|Cost/,
  sel: /Auswahl|Selection/,
  map: /Karte|Map/,
} as const;

/** Row from a list in the elements panel, found via its label. */
export function listRow(page: Page, list: string, label: string): Locator {
  return page
    .locator(`#${list} .lrow`)
    .filter({ has: page.locator(".b", { hasText: new RegExp(`^${label}$`) }) });
}

/** Select an element via its row in the elements panel. */
export async function selectRow(page: Page, list: string, label: string): Promise<void> {
  await openPane(page, PANE.list);
  await listRow(page, list, label).first().click();
}

/** Select a conduit by the start of its name. */
export async function selectConduit(page: Page, label: string): Promise<void> {
  await openPane(page, PANE.list);
  await page
    .locator("#l-conds .lrow")
    .filter({ has: page.locator(".t", { hasText: label }) })
    .first()
    .click();
}

/** Click an element on the map (pointerdown selects, pointerup ends the drag). */
export async function selectMarker(page: Page, id: string): Promise<void> {
  // Camera/AP/house are a circle, a junction a rotated diamond — both `.body`.
  const body = page.locator(`#g-markers .marker[data-id="${id}"] .body`).first();
  // The map panel is wider than it is tall, so `syncAspect` trims a square saved view
  // vertically and an element near the top edge ends up outside the panel — the click
  // would land on the header instead. ⌂ frames the plan again, the same button a user
  // would reach for. Only when needed, so no test gets a view change it didn't ask for.
  const inView = () =>
    body.evaluate((n) => {
      const b = n.getBoundingClientRect();
      const m = document.getElementById("mapwrap")!.getBoundingClientRect();
      return b.top >= m.top && b.bottom <= m.bottom && b.left >= m.left && b.right <= m.right;
    });
  if (!(await inView())) {
    await page.locator("#z-fit").click();
    await expect.poll(inView).toBe(true);
  }
  await body.click();
}

/** Map units → screen coordinates, via the SVG's real CTM. */
export async function toScreen(
  page: Page,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([mx, my]) => {
      const svg = document.getElementById("svg") as unknown as SVGSVGElement;
      const p = svg.createSVGPoint();
      p.x = mx;
      p.y = my;
      const q = p.matrixTransform(svg.getScreenCTM()!);
      return { x: q.x, y: q.y };
    },
    [x, y],
  );
}

/** Click on a position given in map units. */
export async function clickMap(page: Page, x: number, y: number): Promise<void> {
  const p = await toScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
}

/** Right-click on a map coordinate; while drawing this finishes the draft. */
export async function rightClickMap(page: Page, x: number, y: number): Promise<void> {
  const p = await toScreen(page, x, y);
  await page.mouse.click(p.x, p.y, { button: "right" });
}

/**
 * Flip a switch in the `.sw` pattern. The checkbox itself sits outside the
 * viewport — it's operated via its label, exactly like by hand.
 */
export async function toggleSwitch(page: Page, id: string): Promise<void> {
  await page.locator(`label:has(#${id}) span`).first().click();
}

/** Send a key to the document — the tools hang off a keydown there. */
export async function press(page: Page, key: string): Promise<void> {
  await page.locator("body").press(key);
}

/** The status box of the selection panel. */
export function linkText(page: Page): Locator {
  return page.locator("#f-link");
}

/** A ring on the marker: `circle.alert`, optionally `.warn` / `.err`. */
export function ring(page: Page, id: string, kind?: "warn" | "err"): Locator {
  return page.locator(`#g-markers .marker[data-id="${id}"] circle.alert${kind ? `.${kind}` : ""}`);
}

/** Read the active plan from localStorage. */
export async function savedPlan(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const id = localStorage.getItem("sl-current");
    return JSON.parse(localStorage.getItem(`sl-plan:${id}`) ?? "{}");
  });
}
