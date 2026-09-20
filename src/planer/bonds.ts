// Conduit ends bound to an element, and the snapping that creates them.
import { state, view } from "./store";
import { svg } from "./dom";
import type { Item } from "./types";

// ---------- Bonds: conduit ends attached to a junction ----------
// A point with `at: "<itemId>"` sits on this element and moves with it.
// x/y are still recorded so that length, export, and rendering
// don't need to know anything about bonds.
const SNAP_SCREEN_PX = 16;

function snapDist(): number {
  return SNAP_SCREEN_PX * (view.w / Math.max(1, svg.clientWidth));
}

// A conduit ends at whatever it feeds: junction, hub, switch — but also
// directly at a camera or an AP. That's why it snaps to any element.
function snapTargets(): Item[] {
  return state.items;
}

export function snapTarget(x: number, y: number): Item | null {
  const d = snapDist();
  let best: Item | null = null,
    bd = d;
  for (const it of snapTargets()) {
    const dist = Math.hypot(it.x - x, it.y - y);
    if (dist <= bd) {
      bd = dist;
      best = it;
    }
  }
  return best;
}

export function syncBonds(): void {
  const byId = new Map(state.items.map((i) => [i.id, i]));
  for (const c of state.conduits)
    for (const p of c.points) {
      if (!p.at) continue;
      const it = byId.get(p.at);
      if (!it) {
        delete p.at;
        continue;
      }
      p.x = it.x;
      p.y = it.y;
    }
}

export function boundCount(id: string): number {
  let n = 0;
  for (const c of state.conduits) for (const p of c.points) if (p.at === id) n++;
  return n;
}

export function unbindAll(id: string): void {
  for (const c of state.conduits) for (const p of c.points) if (p.at === id) delete p.at;
}
