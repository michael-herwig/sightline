// @ts-check
import { defineConfig } from "astro/config";

// Static output: every page is prerendered and the deploy is a plain folder of
// files. The planner is a page like any other — /planner becomes
// dist/planner/index.html, which every static host serves at /planner.
export default defineConfig({
  site: "https://sightline.herwig-systems.de",
  server: { port: 4321, host: true },
  // jsPDF is loaded with `await import("jspdf")` inside the export handler, so
  // the 400 KB only ship when someone exports. In dev that means Vite does not
  // see it while scanning at startup: the first PDF export triggers a
  // re-optimisation, and the request that triggered it dies with
  // "504 Outdated Optimize Dep" — the export silently does nothing until the
  // page is reloaded. Naming it here pre-bundles it with everything else.
  // The production chunking is unaffected.
  vite: { optimizeDeps: { include: ["jspdf"] } },
});
