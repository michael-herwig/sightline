// Save, load and share a plan: JSON file and the #p= link.
import { createPlan } from "./hooks";
import { t } from "./i18n";
import { stampGeo } from "./geo";
import { planFile, sane, state } from "./store";
import { $, setStatus } from "./dom";

export function exportPlan() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(stampGeo(state), null, 2)], { type: "application/json" }),
  );
  a.download = planFile();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function importPlan(f: File) {
  f.text().then((txt) => {
    try {
      const v = JSON.parse(txt);
      if (sane(v)) {
        createPlan(v);
        setStatus(t("status.loadedlocal"));
      } else alert(t("import.badformat"));
    } catch {
      alert(t("import.badjson"));
    }
  });
}

// The whole plan lives in the link — no server, no account. deflate-raw if the
// browser supports it, otherwise plain text in base64.
const b64url = {
  enc: (bytes: Uint8Array) => {
    let out = "";
    bytes.forEach((b) => (out += String.fromCharCode(b)));
    return btoa(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec: (str: string) => {
    const raw = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  },
};

// Uint8Array<ArrayBuffer>, not the default Uint8Array: only a non-shared
// buffer counts as a BlobPart.
async function squeeze(bytes: Uint8Array<ArrayBuffer>, dir: "in" | "out") {
  const Ctor = dir === "in" ? window.CompressionStream : window.DecompressionStream;
  if (typeof Ctor !== "function") return null;
  try {
    const buf = await new Response(
      new Blob([bytes]).stream().pipeThrough(new Ctor("deflate-raw")),
    ).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

async function shareLink() {
  const json = new TextEncoder().encode(JSON.stringify(stampGeo(state)));
  const packed = await squeeze(json, "in");
  const payload = packed ? "2" + b64url.enc(packed) : "1" + b64url.enc(json);
  try {
    history.replaceState(null, "", "#p=" + payload);
  } catch {}
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    setStatus(t("share.copied"));
  } catch {
    setStatus(t("share.failed"));
  }
}

// A foreign save: whatever the link carries. sane() decides, not this function.
export async function stateFromHash(): Promise<unknown> {
  const m = /[#&]p=([^&]+)/.exec(location.hash || "");
  if (!m || m[1].length < 2) return null;
  try {
    const raw = b64url.dec(m[1].slice(1));
    const bytes = m[1][0] === "2" ? await squeeze(raw, "out") : raw;
    if (!bytes) return null;
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function wireShare() {
  $("t-save").onclick = exportPlan;

  $("t-open").onclick = () => $("t-file").click();

  $("t-file").onchange = (e: { target: HTMLInputElement }) => {
    const f = e.target.files![0];
    if (f) importPlan(f);
    e.target.value = "";
  };

  $("t-share").onclick = shareLink;
}
