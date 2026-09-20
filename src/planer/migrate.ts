// Old save shapes -> current ones. Share links from earlier builds run through here.
import { CONDUITS, JUNCTIONS, PIPES, isHousing } from "./catalogs";
import { cabList, condCables, ductCables } from "./conduit";
import type { Conduit, Gear, Item } from "./types";

// Old state: a jb carried exactly one model, even when it was a device. New:
// model = housing/location, gear = what sits inside it. This path must stay.
// any: like migrateConduit(), takes a legacy point — old saves and tests feed
// it partial objects (missing id/x/y, or `gear` not even an array yet).
export function migrateJb(it: any): Item {
  const gear: Gear[] = (Array.isArray(it.gear) ? it.gear : [])
    .filter((g: any) => g && JUNCTIONS[g.model])
    .map((g: any) => ({ model: g.model, n: Math.max(1, +g.n || 1) }));
  it.gear = gear;
  if (!isHousing(it.model || "")) {
    if (it.model && JUNCTIONS[it.model]) gear.unshift({ model: it.model, n: 1 });
    it.model = "indoor";
  }
  return it;
}

// Four shapes are out there in the wild, all four land here:
//   { type: "fiber", cables: 2 }                          — very old, catalog template
//   { pipe, ducts: <Zahl>, cables: [{type,n}] }           — flat, cables with no duct assignment
//   { pipe, ducts: [{ cables: [{type,n}] }] }             — one duct type for the whole trench
//   { kind, ducts: [{ pipe, cables: [{type,n}] }] }       — now: kind on the conduit, type per duct
// Share links carry whatever shape they had back then, **this path must stay**.
// `pipe: "none"` used to be a duct type and is now its own kind: the cable run.
// any: a legacy share-link conduit — the four shapes above are mutually
// incompatible (e.g. `ducts` is a plain number in one, an array in the others),
// so there is no single interface to give it before this function untangles it.
export function migrateConduit(c: any): Conduit {
  const bare = c.pipe === "none";
  let pipe0 = PIPES[c.pipe] ? c.pipe : ""; // old duct type — applied to every duct in the trench
  delete c.pipe;
  if (Array.isArray(c.ducts)) {
    c.ducts = c.ducts.slice(0, 6).map((d: any) => ({
      pipe: d && PIPES[d.pipe] ? d.pipe : pipe0 || "dn50",
      cables: cabList(d && d.cables),
    }));
  } else {
    // Flat or very old: all cables move into duct 1, the rest stays empty.
    let n = Math.max(1, Math.min(6, +c.ducts || 1)),
      cab = cabList(c.cables);
    if (!Array.isArray(c.cables)) {
      const pre = CONDUITS[c.type] || CONDUITS.pipe,
        first = ductCables(pre.ducts[0])[0];
      const k = Math.max(0, +c.cables || 0);
      pipe0 = pre.ducts[0].pipe || "dn50";
      n = 1;
      cab = first && k > 0 ? [{ type: first.type, n: k }] : [];
      delete c.type;
    }
    c.ducts = Array.from({ length: n }, (_, i) => ({
      pipe: pipe0 || "dn50",
      cables: i ? [] : cab,
    }));
  }
  if (!c.ducts.length) c.ducts = [{ pipe: "dn50", cables: [] }];
  c.kind = c.kind === "cable" || bare ? "cable" : "trench";
  // A cable run is exactly one bundle with no duct: everything being pulled lies together.
  if (c.kind === "cable") c.ducts = [{ cables: condCables(c) }];
  delete c.cables;
  return c;
}
