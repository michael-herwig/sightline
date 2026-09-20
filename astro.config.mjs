// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// The planner is a plain file in public/ (no build step), so /planner is a
// directory index. The built Node server and static hosts resolve that on
// their own; `astro dev` serves public/ by exact path only and would 404.
// ponytail: dev-only rewrite, three lines beats turning the planner into a page.
const plannerIndex = {
  name: "planner-index",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const [path, query] = (req.url ?? "").split("?");
      if (path === "/planner" || path === "/planner/")
        req.url = "/planner/index.html" + (query ? "?" + query : "");
      next();
    });
  },
};

// ponytail: static site + Node adapter; only /api/state renders on demand
// (prerender = false there). output:'server' only once more than one endpoint
// genuinely needs to be server-side.
export default defineConfig({
  site: "https://sightline.herwig-systems.de",
  adapter: node({ mode: "standalone" }),
  server: { port: 4321, host: true },
  vite: { plugins: [plannerIndex] },
});
