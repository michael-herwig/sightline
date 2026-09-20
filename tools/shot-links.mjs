import { chromium } from "playwright";
const out = process.argv[2];
const PX = 5.957;
const FIXTURE = {
  name: "Anschlussplan",
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
      x: 100,
      y: 100,
      note: "",
      wan: { type: "fiber", speed: 1000 },
    },
    {
      id: "s1",
      kind: "jb",
      model: "cab",
      gear: [
        { model: "tplink-mc220l", n: 1 },
        { model: "usw-ultra-60w", n: 1 },
      ],
      label: "S1",
      x: 300,
      y: 260,
      note: "",
    },
    {
      id: "k1",
      kind: "cam",
      model: "g6-bullet",
      label: "K1",
      x: 300 + 40 * PX,
      y: 260,
      rot: 0,
      note: "",
    },
    { id: "k2", kind: "cam", model: "g6-bullet", label: "K2", x: 800, y: 700, rot: 0, note: "" },
    { id: "s3", kind: "jb", model: "lite8", label: "S3", x: 200, y: 600, note: "" },
    { id: "a1", kind: "ap", model: "u7-lite", label: "A1", x: 600, y: 300, note: "" },
  ],
  conduits: [
    {
      id: "cf",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser",
      points: [
        { x: 100, y: 100, at: "h1" },
        { x: 300, y: 260, at: "s1" },
      ],
    },
    {
      id: "cc",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Kupfer",
      points: [
        { x: 300, y: 260, at: "s1" },
        { x: 300 + 40 * PX, y: 260, at: "k1" },
      ],
    },
    {
      id: "cf2",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser 2",
      points: [
        { x: 100, y: 100, at: "h1" },
        { x: 200, y: 600, at: "s3" },
      ],
    },
  ],
  infra: { ucg: { on: true, qty: 1 } },
};
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
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
await p.waitForTimeout(1500);
await p.click("#z-fit");
await p.waitForTimeout(1200);
await p.screenshot({ path: out + "/1-map.png" });
await (await p.$(".mapwrap")).screenshot({ path: out + "/map-only.png" });
const sel = async (id, name) => {
  await p.evaluate((id) => {
    const g = document.querySelector(`.marker[data-id="${id}"]`);
    g.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }, id);
  await p.waitForTimeout(400);
  const pane = await p.$("#pane-sel");
  await pane.screenshot({ path: out + `/sel-${name}.png` });
};
await sel("k2", "k2-unconnected");
await sel("k1", "k1-ok");
await sel("s1", "s1-switch");
await sel("s3", "s3-nosfp");
await sel("h1", "hub");
await p.click('#cat-tabs [data-tab="jb"]');
await p.waitForTimeout(300);
await (await p.$("#pane-build")).screenshot({ path: out + "/build-jb.png" });
await p.click('#cat-tabs [data-tab="gear"]');
await p.waitForTimeout(400);
await (await p.$("#pane-build")).screenshot({ path: out + "/build-gear.png" });
await p.click('#cat-gear [data-key="unvr"]');
await p.waitForTimeout(400);
await (await p.$("#pane-sel")).screenshot({ path: out + "/sel-gear.png" });
const tab = async (name) => {
  const tabs = await p.$$(".dv-tab");
  for (const t of tabs) {
    if ((await t.textContent()).trim() === name) {
      await t.click();
      break;
    }
  }
  await p.waitForTimeout(500);
};
await tab("Elemente");
await (await p.$("#pane-list")).screenshot({ path: out + "/list.png" });
await tab("Kosten");
await (await p.$("#pane-cost")).screenshot({ path: out + "/cost.png" });
await tab("Bauen");
await p.click('#cat-tabs [data-tab="cam"]');
await p.fill("#cat-q", "outdoor");
await p.waitForTimeout(400);
await (await p.$("#pane-build")).screenshot({ path: out + "/build-cam-outdoor.png" });
console.log("errors:", errs);
await b.close();
