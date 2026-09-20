// "Open a plan" on the landing page: the plans already in this browser, and a
// JSON file from somewhere else.
import { LANG_EVENT, lang, words } from "./lang";
import { planIndex, removePlan } from "./storage";

/** Newest first, each row opening exactly its own plan by id. */
export function wirePlanList(): void {
  const card = document.getElementById("resumeCard");
  const box = document.getElementById("planList");
  const empty = document.getElementById("noPlans");
  if (!card || !box || !empty) return;

  const show = () => {
    const list = planIndex();
    empty.hidden = list.length > 0;
    card.hidden = list.length === 0;
    if (!list.length) return;

    const w = words();
    const loc = lang() === "en" ? "en-GB" : "de-DE";
    box.replaceChildren(
      ...list.map((e) => {
        const name = (e.name ?? "").trim() || (w["resume.unnamed"] ?? "");
        const href = `/planner#o=${encodeURIComponent(e.id)}`;
        const tr = document.createElement("tr");
        tr.tabIndex = 0;
        tr.addEventListener("click", (ev) => {
          if (!(ev.target as Element).closest("a, button")) location.href = href;
        });
        tr.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" && ev.target === tr) location.href = href;
        });

        const tdName = document.createElement("td");
        const a = document.createElement("a");
        a.href = href;
        a.textContent = name;
        tdName.append(a);

        const tdN = document.createElement("td");
        tdN.className = "num";
        tdN.textContent = String(e.n ?? 0);

        const tdWhen = document.createElement("td");
        tdWhen.className = "num";
        if (e.updated) {
          const time = document.createElement("time");
          time.dateTime = new Date(e.updated).toISOString();
          time.textContent = new Date(e.updated).toLocaleString(loc, {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          });
          tdWhen.append(time);
        }

        const tdAct = document.createElement("td");
        tdAct.className = "act";
        const del = document.createElement("button");
        del.type = "button";
        del.className = "del";
        del.title = w["col.del"] ?? "";
        del.setAttribute("aria-label", `${w["col.del"] ?? ""}: ${name}`);
        const icon = document.createElement("i");
        icon.className = "codicon codicon-trash";
        icon.setAttribute("aria-hidden", "true");
        del.append(icon);
        del.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (confirm((w["plan.del.confirm"] ?? "").replace("{name}", name))) {
            removePlan(e.id);
            show();
          }
        });
        tdAct.append(del);

        tr.append(tdName, tdN, tdWhen, tdAct);
        return tr;
      }),
    );
  };

  show();
  document.addEventListener(LANG_EVENT, show); // dates and the bin's label follow the language
}

/**
 * A plan file is handed on as a share link. That way there is exactly one path
 * for adopting a foreign state — the one that is validated anyway.
 */
export function wireOpenFile(): void {
  const pick = document.getElementById("planFile") as HTMLInputElement | null;
  const open = document.getElementById("openFile");
  const err = document.getElementById("fileErr");
  if (!pick || !open || !err) return;

  open.addEventListener("click", () => pick.click());
  pick.addEventListener("change", async () => {
    const file = pick.files?.[0];
    if (!file) return;
    err.hidden = true;
    try {
      const plan: unknown = JSON.parse(await file.text());
      const shape = plan as { items?: unknown; conduits?: unknown } | null;
      if (!shape || !Array.isArray(shape.items) || !Array.isArray(shape.conduits)) {
        throw new Error("not a plan");
      }
      const bytes = new TextEncoder().encode(JSON.stringify(plan));
      let payload = "1" + b64url(bytes);
      if (typeof CompressionStream === "function") {
        const packed = new Uint8Array(
          await new Response(
            new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw")),
          ).arrayBuffer(),
        );
        payload = "2" + b64url(packed);
      }
      location.href = `/planner#p=${payload}`;
    } catch {
      err.textContent = words()["open.err"] ?? "";
      err.hidden = false;
    } finally {
      pick.value = "";
    }
  });
}

function b64url(bytes: Uint8Array): string {
  let out = "";
  bytes.forEach((b) => (out += String.fromCharCode(b)));
  return btoa(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
