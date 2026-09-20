// Scale screenshots: 1 m, 50 m and 2 km edge length, plus the groups, the
// hover pairing and the product row with the Amazon link.
// Usage: ocx exec -- node tools/shot-zoom.mjs <folder>   (server must be running)
import { chromium } from "playwright";
const out = process.argv[2];
const PX = 5.957;
const FIXTURE = {
  name: "Zoomprobe",
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
      gear: [{ model: "usw-ultra-60w", n: 1 }],
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
    { id: "k2", kind: "cam", model: "g6-bullet", label: "K2", x: 800, y: 700, rot: 200, note: "" },
    { id: "a1", kind: "ap", model: "u7-outdoor", label: "A1", x: 600, y: 300, note: "" },
    // Four elements within one to two metres — exactly the case groups exist for.
    { id: "k3", kind: "cam", model: "g6-turret", label: "K3", x: 120, y: 112, rot: 90, note: "" },
    { id: "a2", kind: "ap", model: "u7-pro", label: "A2", x: 126, y: 112, note: "" },
    { id: "j2", kind: "jb", model: "shaft", label: "J2", x: 123, y: 118, note: "" },
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
      ducts: 2,
      cables: [{ type: "cat", n: 1 }],
      label: "Kupfer",
      points: [
        { x: 300, y: 260, at: "s1" },
        { x: 300 + 40 * PX, y: 260, at: "k1" },
      ],
    },
    {
      id: "cp",
      pipe: "dn63",
      ducts: 1,
      cables: [{ type: "power", n: 1 }],
      label: "Strom",
      points: [
        { x: 100, y: 100, at: "h1" },
        { x: 600, y: 300, at: "a1" },
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
await p.waitForTimeout(1800);

const span = () =>
  p.evaluate(() => {
    const vb = document.getElementById("svg").getAttribute("viewBox").split(/\s+/).map(Number);
    return vb[2] / 5.9055; // edge length of the viewport in metres
  });
// Via the zoom buttons, not the viewBox: applyView() rewrites it anyway.
const zoomTo = async (metres) => {
  for (let i = 0; i < 60; i++) {
    const m = await span();
    if (Math.abs(m - metres) / metres < 0.12) break;
    await p.click(m > metres ? "#z-in" : "#z-out");
    await p.waitForTimeout(60);
  }
  await p.waitForTimeout(1600); // tiles and the debounced group check
};
const tab = async (name) => {
  for (const t of await p.$$(".dv-tab")) {
    if ((await t.textContent()).trim() === name) {
      await t.click();
      break;
    }
  }
  await p.waitForTimeout(500);
};
// Centre on an element without leaving it selected: the row in the list
// calls centerOn(), Escape clears the selection again. The viewport stays put.
const centerOn = async (label) => {
  await tab("Elemente");
  await p.evaluate((lab) => {
    const row = [...document.querySelectorAll("#pane-list .lrow")].find(
      (r) => r.querySelector(".b").textContent.trim() === lab,
    );
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, label);
  await p.waitForTimeout(500);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
};
const shot = async (name) => {
  await (await p.$(".mapwrap")).screenshot({ path: `${out}/${name}.png` });
};

await p.click("#z-fit");
await p.waitForTimeout(1600);
await shot("zoom-fit");

await centerOn("K3");
await zoomTo(2000);
console.log("2 km →", (await span()).toFixed(1), "m");
await shot("zoom-2km");
await zoomTo(120);
console.log("groups →", (await span()).toFixed(1), "m");
await shot("zoom-cluster");
await zoomTo(50);
console.log("50 m →", (await span()).toFixed(1), "m");
await shot("zoom-50m");
await zoomTo(1);
console.log("1 m →", (await span()).toFixed(2), "m");
await shot("zoom-1m");

// Hover: a row in the element list highlights the map node
await p.click("#z-fit");
await p.waitForTimeout(1500);
await tab("Elemente");
await p.hover("#l-conds .lrow");
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/hover-list-map.png` });

// Image export: does the PNG look like the map?
await p.click("#t-export");
await p.waitForTimeout(300);
const png = await p.evaluate(async () => {
  document.getElementById("exp-dl").click();
  await new Promise((r) => setTimeout(r, 2500));
  return document.getElementById("status") ? document.getElementById("status").textContent : "";
});
console.log("Export:", png);
await p.keyboard.press("Escape");
await p.waitForTimeout(300);

// Product row with the Amazon link
await tab("Bauen");
await p.click('#cat-tabs [data-tab="cam"]');
await p.waitForTimeout(300);
await p.click("#cat-cams .item");
await p.waitForTimeout(700);
await (await p.$("#pane-sel")).screenshot({ path: `${out}/amazon-sel.png` });
await (await p.$("#pane-sel .product .pbar")).screenshot({ path: `${out}/amazon-pbar.png` });

console.log("errors:", errs);
await b.close();
