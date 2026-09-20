import type { APIRoute } from "astro";
import fs from "node:fs/promises";
import path from "node:path";

// The planner so far only ran against localStorage (and optionally window.claude.use("db")).
// This endpoint is the server-side store: one file, one state — so the latest
// working state survives a browser switch and cleared site data.
export const prerender = false;

const FILE = path.join(process.cwd(), "data", "plan.json");
const MAX_BYTES = 1_000_000; // ponytail: a plan is a few KB; anything above that is an error

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const GET: APIRoute = async () => {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    return new Response(raw, {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (e: any) {
    if (e?.code === "ENOENT") return new Response(null, { status: 204 });
    return json({ error: "read failed" }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) return json({ error: "too large" }, 413);

  const raw = await request.text();
  if (raw.length > MAX_BYTES) return json({ error: "too large" }, 413);

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) {
    return json({ error: "not a plan" }, 400);
  }

  const body = JSON.stringify({ ...parsed, savedAt: new Date().toISOString() }, null, 2);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, body, "utf8");
  await fs.rename(tmp, FILE); // atomic: an aborted write can't corrupt the stored state
  return json({ ok: true });
};
