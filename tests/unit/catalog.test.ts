import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APS,
  CAMS,
  INFRA,
  JUNCTIONS,
  PRODUCTS,
  isCurrent,
  productOf,
} from "../../src/catalog/index";
import { codecGrade, codecText, isOpen, opennessGrade, opennessText } from "../../src/planer/specs";
import type { Product } from "../../src/catalog/schema";

// The product directory: one folder per product, loaded by import.meta.glob.
// These tests are the contract between the files on disk and what the planner
// reads out of them — every rule here exists because breaking it would be silent.

const DIR = new URL("../../src/catalog/", import.meta.url);
const folders = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const schema = JSON.parse(readFileSync(new URL("schema.json", DIR), "utf8"));

// ---------------------------------------------------------------- validator
// A dozen lines instead of ajv: the generated schema only uses $ref, type,
// properties, required, additionalProperties, items, enum, const and anyOf.
// Anything richer would have to be added here on purpose.
function validate(v: unknown, s: any, at = "$"): string[] {
  if (s.$ref) return validate(v, schema.$defs[s.$ref.split("/").pop()!], at);
  if (s.anyOf)
    return s.anyOf.some((x: any) => !validate(v, x, at).length) ? [] : [`${at}: matches nothing`];
  if (s.enum) return s.enum.includes(v) ? [] : [`${at}: ${JSON.stringify(v)} is not allowed`];
  if ("const" in s) return v === s.const ? [] : [`${at}: expected ${s.const}`];
  if (s.type === "string") return typeof v === "string" ? [] : [`${at}: not a string`];
  if (s.type === "number") return typeof v === "number" ? [] : [`${at}: not a number`];
  if (s.type === "boolean") return typeof v === "boolean" ? [] : [`${at}: not a boolean`];
  if (s.type === "array")
    return Array.isArray(v)
      ? v.flatMap((x, i) => validate(x, s.items, `${at}[${i}]`))
      : [`${at}: not an array`];
  if (s.type === "object") {
    if (!v || typeof v !== "object" || Array.isArray(v)) return [`${at}: not an object`];
    const o = v as Record<string, unknown>;
    const errs = (s.required || [])
      .filter((k: string) => o[k] === undefined)
      .map((k: string) => `${at}.${k}: missing`);
    for (const [k, val] of Object.entries(o)) {
      const sub = s.properties[k];
      if (!sub) errs.push(`${at}.${k}: unknown field`);
      else errs.push(...validate(val, sub, `${at}.${k}`));
    }
    return errs;
  }
  return [];
}

const raw = (name: string) =>
  JSON.parse(readFileSync(new URL(name + "/product.json", DIR), "utf8")) as Product & {
    $schema: string;
  };

const all = folders.map(raw);

describe("the product directory", () => {
  it("loads every folder — no file is skipped and none is invented", () => {
    expect(folders.length).toBeGreaterThanOrEqual(100);
    expect(PRODUCTS.length).toBe(folders.length);
  });

  it("every file validates against the generated schema", () => {
    const errs = all.flatMap((p) => validate(p, schema).map((e) => `${p.kind}-${p.id} ${e}`));
    expect(errs).toEqual([]);
  });

  it("the folder is named after the product and no id repeats inside its kind", () => {
    expect(folders.filter((n) => !raw(n) || `${raw(n).kind}-${raw(n).id}` !== n)).toEqual([]);
    const keys = all.map((p) => p.kind + ":" + p.id);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("points its editor at the schema and carries a dated price", () => {
    expect(all.filter((p) => p.$schema !== "../schema.json").map((p) => p.id)).toEqual([]);
    expect(all.filter((p) => !/^\d{4}-\d{2}$/.test(p.priceDate)).map((p) => p.id)).toEqual([]);
    // One research pass, one date — a mixed catalogue is a catalogue nobody can judge.
    expect([...new Set(all.map((p) => p.priceDate))]).toEqual(["2026-09"]);
  });

  it("every bilingual field carries both languages", () => {
    const pairs: [string, unknown][] = [];
    for (const p of all)
      for (const k of ["name", "description", "useCases", "caveats", "mount", "tags"] as const) {
        const v = p[k] as { de?: unknown; en?: unknown } | undefined;
        if (v) pairs.push([`${p.kind}-${p.id}.${k}`, v]);
      }
    const missing = pairs
      .filter(([, v]) => {
        const o = v as { de?: unknown; en?: unknown };
        return !o.de || !o.en || String(o.de).trim() === "" || String(o.en).trim() === "";
      })
      .map(([k]) => k);
    expect(missing).toEqual([]);
  });

  it("a junction says whether it is a place or something that goes into one", () => {
    expect(
      all
        .filter((p) => (p.kind === "jb") !== ["housing", "device"].includes(p.form!))
        .map((p) => p.id),
    ).toEqual([]);
  });
});

describe("the loader rebuilds the shapes the planner expects", () => {
  it("fills all four catalogues in the order of the files", () => {
    expect(Object.keys(CAMS).length).toBe(all.filter((p) => p.kind === "cam").length);
    expect(Object.keys(APS).length).toBe(all.filter((p) => p.kind === "ap").length);
    expect(Object.keys(JUNCTIONS).length).toBe(all.filter((p) => p.kind === "jb").length);
    expect(INFRA.map((i) => i.id)).toEqual(
      all
        .filter((p) => p.kind === "infra")
        .sort((a, b) => a.order - b.order)
        .map((p) => p.id),
    );
  });

  it("the known fixed points come out with exactly their old numbers", () => {
    // These four are the ones links() and the PoE budget lean on. If the file
    // format ever starts rewriting them, this is where it shows.
    expect(JUNCTIONS["tplink-poe170s"]).toMatchObject({ ports: 2, sfpPorts: 0, poePorts: 1 });
    expect(JUNCTIONS["usw-ultra-60w"]).toMatchObject({ ports: 8, poe: 52, sfp: false });
    expect(JUNCTIONS.shaft).toMatchObject({ kind: "housing", ports: 6, price: 40 });
    expect(INFRA.find((i) => i.id === "ucg")).toMatchObject({ ports: 5, sfp: true, poe: 30 });
    // A FRITZ!Box has an SFP cage, but it is the WAN port — LAN-side there is none.
    expect(INFRA.find((i) => i.id === "fb5590")).toMatchObject({ sfp: false });
  });

  it("leaves a field out rather than setting it to undefined", () => {
    // `"powerIn" in m` and `m.sfpPorts != null` are live checks in the planner.
    expect("powerIn" in JUNCTIONS.shaft).toBe(false);
    expect("amazon" in JUNCTIONS.indoor).toBe(false);
  });

  it("splits the shop links back out of `links`", () => {
    expect(CAMS["g6-bullet"].amazon).toMatch(/^https:\/\/www\.amazon\.de\/dp\/[A-Z0-9]{10}$/);
    expect(CAMS["g6-bullet"].url).toBe("physical-security-bullet/products/uvc-g6-bullet");
    expect(JUNCTIONS.shaft.amazonSimilar).toBe(true);
  });

  it("finds a product by kind and id, and nothing for a key that is gone", () => {
    expect(productOf("cam", "g6-bullet")!.price).toBe(179);
    expect(productOf("infra", "ucg")!.specs.role).toBe("router");
    expect(productOf("cam", "no-such-camera")).toBeUndefined();
  });
});

describe("the vendor port list and the planner's port count stay in step", () => {
  // Nothing is derived from `ports`: the planner's numbers are curated (LAN-side
  // SFP, injector throughput, conduit openings on a housing). What has to hold is
  // that a curated number is backed by real connectors — at least the downstream
  // ports, at most everything the data sheet lists.
  const rj45 = (p: Product) => (p.ports || []).filter((x) => x.type === "rj45" || x.type === "wan");
  const sum = (v: { n: number }[]) => v.reduce((a, x) => a + x.n, 0);

  it("the port count sits between the downstream ports and the total", () => {
    const bad = all
      .filter((p) => p.ports && p.specs.ports !== undefined)
      .filter((p) => {
        const out = sum(rj45(p).filter((x) => x.dir === "out"));
        return p.specs.ports! < out || p.specs.ports! > sum(rj45(p));
      })
      .map((p) => p.id);
    expect(bad).toEqual([]);
  });

  it("SFP cages match the data sheet — except the modules that occupy one", () => {
    // An SFP module does not bring a cage along, it fills one. Hence 0, on purpose.
    const modules = ["tplink-sm311ls", "tplink-sm321a", "tplink-sm321b"];
    const bad = all
      .filter((p) => p.ports && p.specs.sfpPorts !== undefined && !modules.includes(p.id))
      .filter(
        (p) => p.specs.sfpPorts !== sum((p.ports || []).filter((x) => x.type.startsWith("sfp"))),
      )
      .map((p) => p.id);
    expect(bad).toEqual([]);
    expect(modules.filter((k) => JUNCTIONS[k].sfpPorts !== 0)).toEqual([]);
  });
});

describe("deprecation", () => {
  it("is what the pickers filter on", () => {
    expect(isCurrent({ status: "current" })).toBe(true);
    expect(isCurrent({})).toBe(true); // an old entry without the field counts as current
    expect(isCurrent({ status: "deprecated" })).toBe(false);
    expect(isCurrent({ status: "eol" })).toBe(false);
  });

  it("nothing in the shipped catalogue is deprecated, so every product is offered", () => {
    expect(all.filter((p) => p.status !== "current").map((p) => p.id)).toEqual([]);
    expect(PRODUCTS.filter((p) => !isCurrent(p))).toEqual([]);
  });

  it("a successor only makes sense once something is no longer current", () => {
    expect(all.filter((p) => p.successor && p.status === "current").map((p) => p.id)).toEqual([]);
    // Whatever a successor points at has to exist in the same catalogue.
    expect(
      all.filter((p) => p.successor && !productOf(p.kind, p.successor)).map((p) => p.id),
    ).toEqual([]);
  });
});

describe("openness and codecs", () => {
  it("green needs both halves, a gap is neutral rather than a warning", () => {
    expect(opennessGrade({ rtsp: true, onvif: true })).toBe("ok");
    expect(opennessGrade({ rtsp: "via-console", onvif: false })).toBe("warn");
    expect(opennessGrade({ rtsp: false, onvif: false, cloud: "required" })).toBe("warn");
    expect(opennessGrade(undefined)).toBe("na");
    expect(opennessText(undefined)).toBe("—");
    expect(opennessText({ rtsp: true, onvif: true })).toBe("RTSP · ONVIF");
  });

  it("the facet asks exactly the question its label asks", () => {
    const open = Object.keys(CAMS).filter((k) => isOpen(CAMS[k].open));
    // Every camera the chip lets through really speaks both protocols.
    expect(open.filter((k) => CAMS[k].open!.rtsp !== true || !CAMS[k].open!.onvif)).toEqual([]);
    expect(open.length).toBeGreaterThan(0);
    expect(isOpen(CAMS["g6-bullet"].open)).toBe(false); // RTSP only through the console
  });

  it("an H.265-only main stream is worth a yellow mark", () => {
    expect(codecGrade({ main: ["h265"] })).toBe("warn");
    expect(codecGrade({ main: ["h265", "h264"] })).toBe("ok");
    expect(codecGrade(undefined)).toBe("na");
    expect(codecText({ main: ["h265"], sub: ["h264"] })).toBe("H.265 · Sub H.264");
    expect(codecText(undefined)).toBe("—");
  });

  it("only cameras answer these questions", () => {
    expect(all.filter((p) => p.kind !== "cam" && (p.open || p.codecs)).map((p) => p.id)).toEqual(
      [],
    );
  });
});
