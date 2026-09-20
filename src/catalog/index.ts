// Loads the product directory: every `<kind>-<id>/product.json` in this folder,
// in one go, at build time.
//
// `import.meta.glob(..., { eager: true })` is Vite's static glob — it inlines the
// JSON into the bundle, so the planner still ships as one file and nothing is
// fetched at runtime. Vitest goes through Vite as well, so the tests see exactly
// what the browser sees.
//
// The planner keeps its old shapes: CAMS, APS, JUNCTIONS and INFRA come out of
// here looking the way `src/planer/catalogs.ts` used to define them, so no caller
// had to change. What is new sits alongside on the same object (`status`, `open`,
// `codecs`, `beam`), and the full record is in `PRODUCTS`.
import type { Ap, Cam, InfraItem, Junction, Model } from "../planer/types";
import type { Product } from "./schema";

export type { Beam, Codecs, Links, Openness, Port, Product, Specs } from "./schema";

const files = import.meta.glob<Product>("./*/product.json", { eager: true, import: "default" });

// A product folder may carry its own `image.webp`; it beats the vendor URL.
// Empty until someone runs `tools/fetch-images.mjs --download` — an empty glob
// is legal and costs nothing.
const images = import.meta.glob<string>("./*/image.webp", {
  eager: true,
  import: "default",
  query: "?url",
});

/** Every product, sorted by kind and `order` — that is the order the UI shows. */
export const PRODUCTS: Product[] = Object.entries(files)
  .map(([path, p]) => {
    const local = images[path.replace("product.json", "image.webp")];
    return local ? { ...p, img: local } : p;
  })
  .sort((a, b) => a.kind.localeCompare(b.kind) || a.order - b.order);

export const productOf = (kind: string, id: string): Product | undefined =>
  PRODUCTS.find((p) => p.kind === kind && p.id === id);

// Leaving a key out is not the same as setting it to undefined: the tests ask
// `"powerIn" in m`, and `optHint()` branches on `m.sfpPorts != null`.
function put(o: Record<string, unknown>, k: string, v: unknown) {
  if (v !== undefined) o[k] = v;
}

/**
 * One product in the shape the planner has always worked with. `specs` spreads
 * first so a curated number can never be shadowed by a generic field.
 */
function legacy(p: Product): Model {
  const m: Record<string, unknown> = { ...p.specs };
  put(m, "name", p.name);
  put(m, "price", p.price);
  put(m, "vendor", p.vendor);
  put(m, "img", p.img);
  put(m, "url", p.links?.vendor);
  put(m, "amazon", p.links?.amazon);
  put(m, "amazonSimilar", p.links?.amazonSimilar);
  put(m, "note", p.description);
  put(m, "tags", p.tags);
  put(m, "mount", p.mount);
  put(m, "powerIn", p.powerIn);
  put(m, "status", p.status);
  put(m, "successor", p.successor);
  put(m, "open", p.open);
  put(m, "codecs", p.codecs);
  put(m, "beam", p.beam);
  // A junction's `kind` is housing vs. device — the catalogue kind is the folder.
  if (p.kind === "jb") put(m, "kind", p.form);
  if (p.kind === "infra") put(m, "id", p.id);
  return m;
}

const record = (kind: string) =>
  Object.fromEntries(PRODUCTS.filter((p) => p.kind === kind).map((p) => [p.id, legacy(p)]));

export const CAMS: Record<string, Cam> = record("cam");
export const APS: Record<string, Ap> = record("ap");
export const JUNCTIONS: Record<string, Junction> = record("jb");
export const INFRA: InfraItem[] = PRODUCTS.filter((p) => p.kind === "infra").map(legacy);

/** Only `current` products are offered; the others stay resolvable for old plans. */
export const isCurrent = (m: Model): boolean => !m || !m.status || m.status === "current";
