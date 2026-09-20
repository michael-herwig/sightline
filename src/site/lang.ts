// Language for the website. The planner does the same thing for its own markup
// (applyStatic in src/planer/dom.ts); both read and write sl-lang, so the
// landing page and the app never end up in different languages.
import { LANG_KEY, migrateKeys } from "./storage";

export type Lang = "de" | "en";
export type Dict = Record<string, string>;

/**
 * The page's texts for both languages. Every page hands them over as JSON in a
 * `<script type="application/json" id="i18n">` — that way this module stays
 * bundled and typed instead of being inlined per page, and the landing page
 * does not carry the guide's texts around.
 */
export interface PageTexts {
  de: Dict;
  en: Dict;
  /** Key of the document title, `page.title` unless the page says otherwise. */
  titleKey?: string;
}

const TITLE = { de: "Sprache umschalten", en: "Switch language" };

let current: Lang = "de";
let texts: PageTexts = { de: {}, en: {} };

/** The language in force, after `wireLang()` has run. */
export function lang(): Lang {
  return current;
}

/** The active dictionary — for text a script builds rather than the markup. */
export function words(): Dict {
  return texts[current] ?? texts.de;
}

/** Fires on `document` after every switch; lists rebuild themselves on it. */
export const LANG_EVENT = "sl:lang";

function readTexts(): PageTexts {
  const node = document.getElementById("i18n");
  if (!node?.textContent) return { de: {}, en: {} };
  try {
    return JSON.parse(node.textContent) as PageTexts;
  } catch {
    return { de: {}, en: {} };
  }
}

function stored(): Lang | null {
  try {
    const l = localStorage.getItem(LANG_KEY);
    return l === "de" || l === "en" ? l : null;
  } catch {
    return null; // private mode: fall back to German
  }
}

/** Write every `data-i18n*` node in the document from the active dictionary. */
export function applyTexts(): void {
  const d = words();
  document.documentElement.lang = current;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const v = d[el.dataset.i18n ?? ""];
    if (v != null) el.textContent = v;
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((el) => {
    const v = d[el.dataset.i18nHtml ?? ""];
    // Guide paragraphs carry <strong>/<em> markup; the source is this repo, not input.
    if (v != null) el.innerHTML = v;
  });
  document.querySelectorAll<HTMLInputElement>("[data-i18n-ph]").forEach((el) => {
    const v = d[el.dataset.i18nPh ?? ""];
    if (v != null) el.placeholder = v;
  });
  const title = d[texts.titleKey ?? "page.title"];
  if (title) document.title = title;
}

/**
 * Reads the page texts, applies the stored language and wires the toggle.
 * Runs the one-time `oh-` → `sl-` key migration first: it has to happen before
 * anything on the page reads storage, and the toggle is on every page.
 */
export function wireLang(): void {
  migrateKeys();
  texts = readTexts();
  current = stored() ?? "de";

  const btn = document.getElementById("siteLang");
  const paint = () => {
    applyTexts();
    if (btn) {
      const title = TITLE[current];
      btn.title = title;
      btn.setAttribute("aria-label", title);
      btn.textContent = current.toUpperCase(); // shows the active language, as in the planner
    }
  };

  btn?.addEventListener("click", () => {
    current = current === "de" ? "en" : "de";
    try {
      localStorage.setItem(LANG_KEY, current);
    } catch {
      /* private mode: the switch still holds for this page */
    }
    paint();
    document.dispatchEvent(new CustomEvent(LANG_EVENT));
  });

  // The toggle sits before the content: at parse time the [data-i18n] nodes don't exist yet.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint);
  else paint();
}
