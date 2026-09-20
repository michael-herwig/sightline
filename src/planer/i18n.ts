// Language: T, t(), tx(). No DOM, no state.
//
// The texts themselves live in src/i18n/de.ts and en.ts — one file per language
// for the planner, the website and the guide. Nothing is defined here any more,
// so a key can never exist in the planner and be missing on the website.
import { planner as de } from "../i18n/de";
import { planner as en } from "../i18n/en";
import { LANG_KEY } from "../site/storage";
import type { Lang } from "./types";

// Language lives in state so it travels along with server storage.
// Static texts hang off the markup as data-i18n, dynamic ones go through t().
export const T = { de, en };

export let lang: Lang = "de";

export function t(k: string, v?: Record<string, string | number>) {
  const all = T as Record<string, Record<string, string>>;
  let out = (all[lang] && all[lang][k]) != null ? all[lang][k] : all.de[k] != null ? all.de[k] : k;
  if (v) for (const n in v) out = out.split("{" + n + "}").join(String(v[n]));
  return out;
}

// Bilingual catalog fields: { de, en } resolves to the active language,
// everything else (product names, numbers) comes back unchanged.
export function tx(v: any): any {
  return v && typeof v === "object" && !Array.isArray(v) ? (v[lang] != null ? v[lang] : v.de) : v;
}

export function rememberLang(l: Lang) {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {}
}

export function storedLang() {
  try {
    const l = localStorage.getItem(LANG_KEY);
    return l === "de" || l === "en" ? l : null;
  } catch {
    return null;
  }
}

// Written from other modules; ES module bindings are read-only for importers.
export const setLangValue = (v: Lang) => {
  lang = v;
};
