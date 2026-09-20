import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APS, CAMS, CONDUITS, INFRA, JUNCTIONS } from "../../src/planer/catalogs";
import { T } from "../../src/planer/i18n";
import { powerIn } from "../../src/planer/gear";
import { whenOf } from "../../src/planer/specs";
import { defaultState } from "../../src/planer/store";

// Repo invariants that used to be text regexes in tools/check.mjs. They now run
// against the real objects.
const SRC = new URL("../../src/planer/", import.meta.url);

const read = (f: string) => readFileSync(new URL(f, SRC), "utf8");

// t() looks keys up by string, so the test does too — the literal's exact key
// union is not what is under test here.
const texts = T as Record<"de" | "en", Record<string, string>>;

describe("i18n", () => {
  it("every key exists in both languages", () => {
    const de = Object.keys(texts.de),
      en = Object.keys(texts.en);
    expect(de.length).toBeGreaterThan(300);
    expect(de.filter((k) => !(k in texts.en))).toEqual([]);
    expect(en.filter((k) => !(k in texts.de))).toEqual([]);
  });

  it("no text is empty", () => {
    const empty = Object.keys(texts.de).filter(
      (k) => !String(texts.de[k]).trim() || !String(texts.en[k]).trim(),
    );
    expect(empty).toEqual([]);
  });
});

describe("Amazon links", () => {
  // Every entry that can carry one — cameras, APs, gear, head end, cables/conduits.
  const entries = [
    ...Object.values(CAMS),
    ...Object.values(APS),
    ...Object.values(JUNCTIONS),
    ...INFRA,
    ...Object.values(CONDUITS),
  ] as any[];
  const urls = entries.map((m) => m.amazon).filter(Boolean) as string[];

  it("is a /dp/<ASIN> address, at least 50 of them, none twice", () => {
    expect(urls.length).toBeGreaterThanOrEqual(50);
    expect(urls.filter((u) => !/^https:\/\/www\.amazon\.de\/dp\/[A-Z0-9]{10}$/.test(u))).toEqual(
      [],
    );
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("JUNCTIONS", () => {
  const J = JUNCTIONS as Record<string, any>;
  const rows = Object.entries(J) as [string, any][];

  it("every entry is a housing or a device", () => {
    expect(rows.length).toBeGreaterThanOrEqual(27);
    expect(
      rows.filter(([, m]) => m.kind !== "housing" && m.kind !== "device").map(([k]) => k),
    ).toEqual([]);
  });

  it("a device says where its power comes from, a housing does not", () => {
    expect(
      rows
        .filter(([, m]) => m.kind === "device" && !["mains", "poe", "none"].includes(m.powerIn))
        .map(([k]) => k),
    ).toEqual([]);
    expect(rows.filter(([, m]) => m.kind === "housing" && "powerIn" in m).map(([k]) => k)).toEqual(
      [],
    );
  });

  it("a mains adapter always means an active device", () => {
    expect(rows.filter(([, m]) => powerIn(m) === "mains" && !m.power).map(([k]) => k)).toEqual([]);
  });

  it("SFP cages sit on the data sheet, not guessed from the port count", () => {
    expect(
      rows.filter(([, m]) => m.power && typeof m.sfpPorts !== "number").map(([k]) => k),
    ).toEqual([]);
  });

  it("the known fixed points stay fixed", () => {
    expect(J["tplink-poe170s"]).toMatchObject({ ports: 2, sfpPorts: 0, poePorts: 1 });
    expect(J["trendnet-tpe-e100"]).toMatchObject({ extend: 100 });
    expect(J["usw-flex-mini"]).toMatchObject({ power: true, powerIn: "poe" });
  });

  it("the twenty catalogued entries exist and each has a buying guide", () => {
    const want = [
      "shaft-s",
      "cab-l",
      "rack19",
      "cab-sw",
      "pit",
      "tplink-poe170s",
      "usw-flex",
      "eth-sp-g2",
      "tplink-sm311ls",
      "trendnet-tpe-e100",
      "mikrotik-crs305",
      "mikrotik-css610-8g",
      "usw-flex-mini",
      "usw-flex-xg",
      "u-poe-plus-plus",
      "tplink-poe380s",
      "trendnet-ti-pg541i",
      "trendnet-ti-pg102i",
      "tplink-sm321a",
      "tplink-sm321b",
    ];
    expect(want.filter((k) => !J[k])).toEqual([]);
    expect(want.filter((k) => !whenOf("jb", k))).toEqual([]);
  });
});

describe("the shipped source carries nothing location-specific", () => {
  it("defaultState() starts empty", () => {
    const d: any = defaultState();
    expect(d.items).toEqual([]);
    expect(d.conduits).toEqual([]);
  });

  it("no parcel numbers and no street-and-number anywhere in src/planer", () => {
    const parcel = /Flurstück \d/i;
    const address = /[A-ZÄÖÜ][a-zäöü]+straße \d|[A-ZÄÖÜ][a-zäöü]+ \d+, \d{5}/;
    const files = readdirSync(SRC).filter((n) => n.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(20); // the scan must not pass by reading nothing
    const hits = files.filter((f) => parcel.test(read(f)) || address.test(read(f)));
    expect(hits).toEqual([]);
  });
});
