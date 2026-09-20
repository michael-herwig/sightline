// Writes src/catalog/schema.json from the types in src/catalog/schema.ts, so an
// editor can validate a product.json while it is being typed.
//
// The types stay the single source: nobody maintains the JSON Schema by hand,
// and tests/unit/catalog.test.ts fails if the checked-in file has drifted.
//
// TypeScript is already a devDependency, so this parses the real AST instead of
// guessing with regexes. It only understands what schema.ts actually uses —
// string/number/boolean, string literals, unions, arrays and references to
// another interface in the same file. Anything else is a hard error, on purpose:
// a silently skipped field would be worse than a failing script.
//
// Usage:  ocx exec -- task catalog:schema
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const SRC = new URL("../src/catalog/schema.ts", import.meta.url);
const OUT = new URL("../src/catalog/schema.json", import.meta.url);

const text = readFileSync(SRC, "utf8");
const file = ts.createSourceFile("schema.ts", text, ts.ScriptTarget.Latest, true);

// The JSDoc above a member, as one line — that is the field's description.
function doc(node) {
  const tags = ts.getJSDocCommentsAndTags(node);
  for (const t of tags) {
    const c = typeof t.comment === "string" ? t.comment : ts.getTextOfJSDocComment(t.comment);
    if (c) return c.replace(/\s+/g, " ").trim();
  }
  return undefined;
}

function type(node) {
  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword:
      return { type: "string" };
    case ts.SyntaxKind.NumberKeyword:
      return { type: "number" };
    case ts.SyntaxKind.BooleanKeyword:
      return { type: "boolean" };
    case ts.SyntaxKind.ArrayType:
      return { type: "array", items: type(node.elementType) };
    case ts.SyntaxKind.TypeReference:
      return { $ref: "#/$defs/" + node.typeName.getText() };
    case ts.SyntaxKind.LiteralType:
      return { const: node.literal.text };
    case ts.SyntaxKind.UnionType: {
      const parts = node.types.map(type);
      // All string literals: an enum reads better in an editor than anyOf.
      return parts.every((p) => "const" in p)
        ? { enum: parts.map((p) => p.const) }
        : { anyOf: parts };
    }
  }
  throw new Error(`schema.ts uses a construct this script does not know: ${node.getText()}`);
}

const defs = {};
for (const st of file.statements) {
  if (!ts.isInterfaceDeclaration(st)) continue;
  const properties = {};
  const required = [];
  for (const m of st.members) {
    if (!ts.isPropertySignature(m)) throw new Error(`${st.name.text}: only plain fields, please`);
    const name = m.name.getText();
    const d = doc(m);
    properties[name] = d ? { description: d, ...type(m.type) } : type(m.type);
    if (!m.questionToken) required.push(name);
  }
  const def = { type: "object", properties, additionalProperties: false };
  if (required.length) def.required = required;
  const d = doc(st);
  defs[st.name.text] = d ? { description: d, ...def } : def;
}

// Every product.json points its editor here with "$schema": "../schema.json".
defs.Product.properties.$schema = { type: "string" };

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://sightline.herwig-systems.de/catalog/schema.json",
  title: "Sightline catalogue product",
  description: "Generated from src/catalog/schema.ts — do not edit by hand.",
  $ref: "#/$defs/Product",
  $defs: defs,
};

export const SCHEMA_JSON = JSON.stringify(schema, null, 2) + "\n";

/** What is on disk right now, parsed — oxfmt owns the file's whitespace. */
export const schemaOnDisk = () => JSON.parse(readFileSync(OUT, "utf8"));

/** The schema as it should be, parsed. Compare these two, never the text. */
export const schemaFromTypes = () => schema;

// Importing this module must not write anything; only running it does. And it
// only writes when the content really changed: oxfmt reformats the file after
// this script has stringified it, so rewriting it every time would leave a
// dirty tree for no reason.
if (process.argv[1] && process.argv[1].endsWith("catalog-schema.mjs")) {
  const same = JSON.stringify(schemaOnDisk()) === JSON.stringify(schema);
  if (same) console.log("schema.json is already up to date");
  else {
    writeFileSync(OUT, SCHEMA_JSON);
    console.log(`schema.json written (${Object.keys(defs).length} definitions)`);
  }
}
