// @ts-check
import { defineConfig } from "astro/config";

// Static output: every page is prerendered and the deploy is a plain folder of
// files. The planner is a page like any other — /planner becomes
// dist/planner/index.html, which every static host serves at /planner.
export default defineConfig({
  site: "https://sightline.herwig-systems.de",
  server: { port: 4321, host: true },
});
