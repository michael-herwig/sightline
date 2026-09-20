// Screenshots for the head end: router + gear in the selection panel, and a
// junction point with its housing data sheet. Usage: node tools/shot-hub.mjs <folder>
import { chromium } from "playwright";
const out = process.argv[2];
const PX = 5.957;
const FIXTURE = {
  name: "Zentrale",
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
      note: "Wohnhaus",
      wan: { type: "fiber", speed: 1000 },
      gear: [{ model: "usw-ultra-60w", n: 1 }],
    },
    {
      id: "kh",
      kind: "cam",
      model: "g6-bullet",
      label: "KH",
      x: 100 + 25 * PX,
      y: 100,
      rot: 0,
      note: "Einfahrt",
    },
    {
      id: "j1",
      kind: "jb",
      model: "cab",
      gear: [
        { model: "tplink-mc220l", n: 1 },
        { model: "usw-ultra-60w", n: 1 },
      ],
      label: "J1",
      x: 420,
      y: 340,
      note: "Garage",
    },
    {
      id: "k1",
      kind: "cam",
      model: "g6-bullet",
      label: "K1",
      x: 420 + 40 * PX,
      y: 340,
      rot: 0,
      note: "",
    },
  ],
  conduits: [
    {
      id: "chk",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Zentralkabel",
      points: [
        { x: 100, y: 100, at: "h1" },
        { x: 100 + 25 * PX, y: 100, at: "kh" },
      ],
    },
    {
      id: "cf",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "fiber", n: 1 }],
      label: "Faser",
      points: [
        { x: 100, y: 100, at: "h1" },
        { x: 420, y: 340, at: "j1" },
      ],
    },
    {
      id: "cc",
      pipe: "dn50",
      ducts: 1,
      cables: [{ type: "cat", n: 1 }],
      label: "Kupfer",
      points: [
        { x: 420, y: 340, at: "j1" },
        { x: 420 + 40 * PX, y: 340, at: "k1" },
      ],
    },
  ],
  infra: { ucg: { on: true, qty: 1 } },
};
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1500, height: 2000 } });
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
const sel = async (id, name) => {
  await p.evaluate((id) => {
    const g = document.querySelector(`.marker[data-id="${id}"]`);
    g.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }, id);
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    document.getElementById("pane-sel").scrollTop = 0;
  });
  await p.waitForTimeout(150);
  await (await p.$("#pane-sel")).screenshot({ path: `${out}/${name}.png`, scale: "css" });
  // The panel scrolls on its own — the connection status sits right at the bottom.
  await p.evaluate(() => {
    const n = document.getElementById("pane-sel");
    n.scrollTop = n.scrollHeight;
  });
  await p.waitForTimeout(300);
  await (await p.$("#pane-sel")).screenshot({ path: `${out}/${name}-link.png`, scale: "css" });
};
await sel("h1", "hub-panel");
await sel("j1", "junction-panel");
// ⓘ next to the add row: the data sheet now sits in the dialog, not the panel
await p.click("#f-geari-new");
await p.waitForTimeout(400);
await (await p.$("#infoDlg")).screenshot({ path: `${out}/info-gear.png`, scale: "css" });
await p.click("#infoClose");
await p.waitForTimeout(200);
// Conduit: cable row and add row carry the same ⓘ
const tab = async (name) => {
  for (const t of await p.$$(".dv-tab")) {
    if ((await t.textContent()).trim() === name) {
      await t.click();
      break;
    }
  }
  await p.waitForTimeout(500);
};
await tab("Elemente");
await p.click("#l-conds .lrow");
await p.waitForTimeout(500);
await tab("Auswahl");
await p.evaluate(() => {
  document.getElementById("pane-sel").scrollTop = 0;
});
await p.waitForTimeout(200);
await (await p.$("#pane-sel")).screenshot({ path: `${out}/conduit-panel.png`, scale: "css" });
await p.click("#f-cabi-new");
await p.waitForTimeout(400);
await (await p.$("#infoDlg")).screenshot({ path: `${out}/info-cable.png`, scale: "css" });
await p.click("#infoClose");
await p.waitForTimeout(200);
await p.screenshot({ path: `${out}/full.png` });
console.log("errors:", errs);
await b.close();
