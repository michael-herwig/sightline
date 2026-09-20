// Every localStorage key of the project, in one place. The planner and the
// website read the same browser storage, so a key that only one of them knows
// about is a bug waiting for a rename.

/** Index of all plans: `PlanEntry[]`, newest first. */
export const INDEX_KEY = "sl-plans";
/** Id of the plan currently open. */
export const CURRENT_KEY = "sl-current";
/** Hand-over slot from the homepage: a single plan without an id yet. */
export const LEGACY_KEY = "sl-plan";
/** Active language, shared between the website and the planner. */
export const LANG_KEY = "sl-lang";
/** One plan per key — a single shared key would silently overwrite the last one. */
export const PLAN_KEY = (id: string) => "sl-plan:" + id;

/**
 * A row of the plan index, as the planner writes it. Every field is optional
 * here: the website renders whatever is in storage, including rows an older
 * build left behind. The planner keeps its own stricter type for writing.
 */
export interface PlanEntry {
  id: string;
  name?: string;
  n?: number;
  updated?: number;
}

/**
 * Keys used to carry the old project prefix `oh-`; migrate them once to `sl-`.
 * One prefix swap, before anything reads: copy where the new key is still free,
 * then drop the old one. Idempotent — a second run finds nothing left to do.
 * The tile cache is keyed by name, so the old one is simply thrown away.
 */
export function migrateKeys(): void {
  try {
    const old: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("oh-")) old.push(k);
    }
    old.forEach((k) => {
      const to = "sl-" + k.slice(3);
      // k came straight out of localStorage.key(), so the read cannot be null.
      if (localStorage.getItem(to) === null) localStorage.setItem(to, localStorage.getItem(k)!);
      localStorage.removeItem(k);
    });
  } catch {
    /* private mode: nothing to carry over */
  }
  try {
    if (typeof caches !== "undefined" && caches.delete) caches.delete("oh-wms-v1");
  } catch {
    /* no Cache API, nothing cached */
  }
}

/** The plan index, or an empty list when storage is unreadable or foreign. */
export function planIndex(): PlanEntry[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(INDEX_KEY) || "[]");
    // Foreign JSON: only the array shape is checked, the rows are taken as written.
    return Array.isArray(v) ? (v as PlanEntry[]) : [];
  } catch {
    return [];
  }
}

/** Drop a plan and its index row; forget it as the current one. */
export function removePlan(id: string): void {
  try {
    localStorage.removeItem(PLAN_KEY(id));
    localStorage.setItem(INDEX_KEY, JSON.stringify(planIndex().filter((e) => e.id !== id)));
    if (localStorage.getItem(CURRENT_KEY) === id) localStorage.removeItem(CURRENT_KEY);
  } catch {
    /* nothing to remove */
  }
}
