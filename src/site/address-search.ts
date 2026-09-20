// Address search on the landing page. The same service the planner uses, so a
// hit found here carries straight over: the planner gets the coordinates and a
// plan name in the hash and starts there.
//
// Nominatim is a free service run by someone else: debounce the keystrokes,
// swallow failures quietly, name the source under the hits. No key, no bulk.
import { words } from "./lang";

const DEBOUNCE_MS = 450;

interface Hit {
  lat: string | number;
  lon: string | number;
  display_name?: string;
}

const shortName = (h: Hit) =>
  (h.display_name ?? "")
    .split(",")
    .slice(0, 2)
    .map((x) => x.trim())
    .join(" ");

export function wireAddressSearch(): void {
  const form = document.getElementById("startGeo") as HTMLFormElement | null;
  const addr = document.getElementById("addr") as HTMLInputElement | null;
  const list = document.getElementById("geoList");
  if (!form || !addr || !list) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  const close = () => {
    list.hidden = true;
    list.replaceChildren();
  };
  const li = (cls: string, text: string) => {
    const el = document.createElement("li");
    el.className = cls;
    el.textContent = text;
    return el;
  };
  const note = (text: string) => {
    list.replaceChildren(li("cred", text));
    list.hidden = false;
  };
  const goTo = (hit: Hit) => {
    const ll = `${(+hit.lat).toFixed(6)},${(+hit.lon).toFixed(6)}`;
    location.href = `/planner#new=1&ll=${ll}&n=${encodeURIComponent(shortName(hit))}`;
  };

  addr.addEventListener("input", () => {
    clearTimeout(timer);
    const q = addr.value.trim();
    if (q.length < 3) {
      close();
      return;
    }
    timer = setTimeout(async () => {
      const mine = ++seq;
      note(words()["geo.busy"] ?? "");
      let hits: Hit[] = [];
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
        const r = await fetch(url, { headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error(String(r.status));
        hits = (await r.json()) as Hit[];
      } catch {
        if (mine === seq) note(words()["geo.failed"] ?? "");
        return;
      }
      if (mine !== seq) return;
      if (!hits.length) {
        note(words()["geo.none"] ?? "");
        return;
      }
      const rows = hits.map((hit) => {
        const parts = (hit.display_name ?? "").split(",").map((x) => x.trim());
        const item = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        const title = document.createElement("span");
        title.className = "t";
        title.textContent = parts.slice(0, 2).join(" ");
        const rest = document.createElement("span");
        rest.className = "s";
        rest.textContent = parts.slice(2).join(", ");
        b.append(title, rest);
        b.addEventListener("click", () => goTo(hit));
        item.append(b);
        return item;
      });
      list.replaceChildren(...rows, li("cred", words()["geo.cred"] ?? ""));
      list.hidden = false;
    }, DEBOUNCE_MS);
  });

  addr.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  document.addEventListener("pointerdown", (e) => {
    const target = e.target as Element | null;
    if (!target?.closest?.(".geobox")) close();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = addr.value.trim();
    // Starting fresh means a new plan — the old one stays put.
    location.href = q ? `/planner#new=1&q=${encodeURIComponent(q)}` : "/planner#new=1";
  });
}
