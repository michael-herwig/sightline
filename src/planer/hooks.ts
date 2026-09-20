// The four app-wide refresh entry points plus "start a new plan", late-bound.
//
// The module graph is a DAG — `import/no-cycle` is an error, and oxlint enforces
// it. These five are the only calls that genuinely point the wrong way: a low
// module (history, tiles, look, a panel) has to trigger a redraw or a save, and
// the code that does the redrawing sits above it. Instead of an import, they go
// through a slot that boot.ts fills before any handler can run. Call sites read
// exactly like a direct call — the name is the same.
//
// Anything else that points upward is a layering mistake, not a new hook.

interface Hooks {
  renderMap: () => void;
  renderSide: () => void;
  scheduleSave: () => void;
  updateHint: () => void;
  createPlan: (seed?: unknown) => void;
}

const nop = () => {};
let impl: Hooks = {
  renderMap: nop,
  renderSide: nop,
  scheduleSave: nop,
  updateHint: nop,
  createPlan: nop,
};

export function setHooks(h: Partial<Hooks>): void {
  impl = { ...impl, ...h };
}

export const renderMap = () => impl.renderMap();
export const renderSide = () => impl.renderSide();
export const scheduleSave = () => impl.scheduleSave();
export const updateHint = () => impl.updateHint();
export const createPlan = (seed?: unknown) => impl.createPlan(seed);
