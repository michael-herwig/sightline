// Conduit screenshots: one pipe with one cable, three pipes each with their own load,
// a cable run without a pipe, a spare pipe, power and data in pipes of different type —
// each at 1:500 and 1:2000.
// Plus the cross-sections, their own toggle, the conduit panel and the image export.
// Usage: ocx exec -- node tools/shot-conduits.mjs <folder>   (server must be running)
import { chromium } from "playwright";
const out = process.argv[2];
const PX = 5.957;
// Five conduits as horizontal ladders stacked above each other, each 25 m long with a kink:
// one pipe/one cable, three pipes/three cables, no pipe, spare pipe, power.
// That way all cases sit side by side in one image.
const X0 = 300,
  Y0 = 200,
  DY = 7 * PX,
  L = 25 * PX;
const lane = (i, id, c) =>
  Object.assign(
    {
      id,
      label: "",
      points: [
        { x: X0, y: Y0 + i * DY },
        { x: X0 + L * 0.45, y: Y0 + i * DY - 1.6 * PX },
        { x: X0 + L, y: Y0 + i * DY },
      ],
    },
    c,
  );
const FIXTURE = {
  name: "Kanalprobe",
  sub: "",
  lang: "de",
  budget: 3000,
  earthwork: 0,
  seq: 9,
  geo: { e0: 356448.6, n0: 5645366.7 },
  items: [
    {
      id: "h1",
      kind: "hub",
      label: "H1",
      x: X0 - 6 * PX,
      y: Y0 - 6 * PX,
      note: "",
      wan: { type: "fiber", speed: 1000 },
    },
  ],
  conduits: [
    lane(0, "c1", { kind: "trench", ducts: [{ pipe: "dn50", cables: [{ type: "fiber", n: 1 }] }] }),
    // Three pipes, each with its own load — and one empty as a spare.
    lane(1, "c2", {
      kind: "trench",
      ducts: [
        { pipe: "dn63", cables: [{ type: "fiber", n: 2 }] },
        { pipe: "dn50", cables: [{ type: "cat", n: 1 }] },
        { pipe: "dn50", cables: [] },
      ],
    }),
    // Cable run: several cables in one bundle, no trench, no earthwork.
    lane(2, "c3", { kind: "cable", ducts: [{ cables: [{ type: "cat", n: 2 }] }] }),
    lane(3, "c4", {
      kind: "trench",
      ducts: [
        { pipe: "dn50", cables: [] },
        { pipe: "dn50", cables: [] },
      ],
    }),
    // Power in the DN 63, data in the DN 50 — each pipe with its own type and its own price.
    lane(4, "c5", {
      kind: "trench",
      ducts: [
        { pipe: "dn63", cables: [{ type: "power", n: 1 }] },
        { pipe: "dn50", cables: [{ type: "cat", n: 2 }] },
      ],
    }),
  ],
  infra: { ucg: { on: true, qty: 1 } },
};
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
await ctx.addInitScript((f) => {
  try {
    localStorage.clear();
    localStorage.setItem("sl-plan", JSON.stringify(f));
  } catch {}
}, FIXTURE);
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errs.push(m.text());
});
await p.goto("http://localhost:4321/planner", { waitUntil: "load" });
await p.waitForTimeout(1800);

// Edge length of the viewport in metres — the scale can be read off from that.
const span = () =>
  p.evaluate(() => {
    const vb = document.getElementById("svg").getAttribute("viewBox").split(/\s+/).map(Number);
    return vb[2] / 5.9055;
  });
const zoomTo = async (metres) => {
  for (let i = 0; i < 60; i++) {
    const m = await span();
    if (Math.abs(m - metres) / metres < 0.12) break;
    await p.click(m > metres ? "#z-in" : "#z-out");
    await p.waitForTimeout(60);
  }
  await p.waitForTimeout(1500);
};
const shot = async (name) => {
  await (await p.$(".mapwrap")).screenshot({ path: `${out}/${name}.png` });
};
const tab = async (name) => {
  for (const x of await p.$$(".dv-tab")) {
    if ((await x.textContent()).trim() === name) {
      await x.click();
      break;
    }
  }
  await p.waitForTimeout(500);
};
// The eye is a fold-out menu: opened twice means closed.
const openView = async () => {
  if (!(await p.evaluate(() => document.getElementById("viewMenu2").classList.contains("open"))))
    await p.click("#viewBtn");
  await p.waitForTimeout(300);
};

await p.click("#z-fit");
await p.waitForTimeout(1600);
await shot("cond-fit");
// A map sheet at 1:500 is around 60 m wide, at 1:2000 around 240 m — at 150 dpi.
await zoomTo(60);
console.log("1:500  →", (await span()).toFixed(1), "m");
await shot("cond-500");
await zoomTo(240);
console.log("1:2000 →", (await span()).toFixed(1), "m");
await shot("cond-2000");
await zoomTo(25);
console.log("close  →", (await span()).toFixed(1), "m");
await shot("cond-nah");
// Crop to the ladders, so trench, pipe lines and strands can be told apart.
await p.screenshot({
  path: `${out}/cond-detail.png`,
  clip: { x: 110, y: 80, width: 620, height: 620 },
});

// Labels off: the cross-sections must go with them.
await openView();
await p.click('#showRow [data-show="labels"]');
await p.waitForTimeout(400);
await shot("cond-nolabels");
await p.click('#showRow [data-show="labels"]');
await p.waitForTimeout(400);

// Image export: the offset paths and badges are normal nodes — they must show up in the PNG.
await zoomTo(60);
await p.click("#t-export");
await p.waitForTimeout(400);
const dl = p.waitForEvent("download", { timeout: 15000 }).catch(() => null);
await p.click("#exp-dl");
const file = await dl;
if (file) {
  await file.saveAs(`${out}/cond-export.png`);
  console.log("Export:", await file.suggestedFilename());
} else console.log("Export: no download");
await p.keyboard.press("Escape");
await p.waitForTimeout(300);

// Cross-sections off, labels on: the two toggles are independent.
await openView();
await p.click('#showRow [data-show="sections"]');
await p.waitForTimeout(400);
await shot("cond-nosections");
await p.click('#showRow [data-show="sections"]');
await p.waitForTimeout(300);
await p.keyboard.press("Escape");
await p.waitForTimeout(200);

// Conduit panel, both kinds: trench with two pipes each of its own type, then the cable run.
await tab("Elemente");
const pickLane = async (i) => {
  await p.evaluate((n) => {
    document
      .querySelectorAll("#l-conds .lrow")
      [n].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, i);
  await p.waitForTimeout(600);
};
await pickLane(4); // c5: DN 63 for power, DN 50 for data
await (await p.$("#pane-sel")).screenshot({ path: `${out}/cond-panel-trench.png` });
await pickLane(2); // c3: cable run without a pipe
await (await p.$("#pane-sel")).screenshot({ path: `${out}/cond-panel-cable.png` });
await p.keyboard.press("Escape");
await p.waitForTimeout(300);

// Selection: the --sel border must still be visible even under the trench.
await zoomTo(40);
await p.evaluate(() => {
  const g = document.querySelector('#g-conduits g.conduit[data-id="c2"] path.core');
  g.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
});
await p.waitForTimeout(500);
await p.screenshot({
  path: `${out}/cond-selected.png`,
  clip: { x: 110, y: 80, width: 620, height: 500 },
});
await p.keyboard.press("Escape");
await p.waitForTimeout(300);

// "Cable" tool: palette and automatic switch-over to Cat6A at the camera.
await p.click("#z-fit");
await p.waitForTimeout(1200);
await p.evaluate(() => {
  document.getElementById("palette").classList.add("labels");
});
await (await p.$(".palette")).screenshot({ path: `${out}/cond-palette.png` });

console.log("errors:", errs);
await b.close();
