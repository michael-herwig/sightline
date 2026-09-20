import { beforeEach, describe, expect, it } from "vitest";
import {
  buildClusters,
  clusterCenter,
  clusterSigOf,
  displayPos,
  setClusters,
} from "../../src/planer/clusters";
import { LOOK_DEF, defaultState, setLookCache, setSel, setState } from "../../src/planer/store";

const item = (id: string, x: number, y: number) => ({
  id,
  kind: "cam",
  model: "g6-bullet",
  label: id,
  x,
  y,
});

function load(items: any[]) {
  setState({ ...defaultState(), items });
}

beforeEach(() => {
  setLookCache({ ...LOOK_DEF });
  setSel(null);
  setClusters([]);
});

describe("buildClusters", () => {
  it("merges markers closer than 36 screen px, leaves the rest alone", () => {
    // upp = map units per screen pixel, so at upp = 1 the radius is 36 map units.
    load([item("a", 0, 0), item("b", 30, 0), item("c", 500, 0)]);
    const cs = buildClusters(1);
    expect(cs).toHaveLength(1);
    expect(cs[0].map((i: any) => i.id)).toEqual(["a", "b"]);
  });

  it("zooming in pulls them apart again", () => {
    load([item("a", 0, 0), item("b", 30, 0)]);
    expect(buildClusters(1)).toHaveLength(1);
    expect(buildClusters(0.1)).toEqual([]);
    // Exactly on the radius still counts as together, one unit further does not.
    load([item("a", 0, 0), item("b", 36, 0)]);
    expect(buildClusters(1)).toHaveLength(1);
    load([item("a", 0, 0), item("b", 37, 0)]);
    expect(buildClusters(1)).toEqual([]);
  });

  it("a cluster of one is not a cluster", () => {
    load([item("a", 0, 0)]);
    expect(buildClusters(1)).toEqual([]);
  });

  it("the selected element stays on its own", () => {
    load([item("a", 0, 0), item("b", 10, 0), item("c", 20, 0)]);
    setSel({ kind: "item", id: "b" });
    const cs = buildClusters(1);
    expect(cs).toHaveLength(1);
    expect(cs[0].map((i: any) => i.id)).toEqual(["a", "c"]);
    // A selected conduit changes nothing.
    setSel({ kind: "conduit", id: "b" });
    expect(buildClusters(1)[0]).toHaveLength(3);
  });

  it("the gear icon switches clustering off entirely", () => {
    load([item("a", 0, 0), item("b", 10, 0)]);
    setLookCache({ ...LOOK_DEF, cluster: false });
    expect(buildClusters(1)).toEqual([]);
  });
});

describe("clusterSigOf, clusterCenter, displayPos", () => {
  it("the signature names the members, so a changed set is visible", () => {
    expect(
      clusterSigOf([
        [{ id: "a" }, { id: "b" }],
        [{ id: "c" }, { id: "d" }],
      ]),
    ).toBe("a,b|c,d");
    expect(clusterSigOf([])).toBe("");
  });

  it("the centre is the mean of the members", () => {
    expect(
      clusterCenter([
        { x: 0, y: 0 },
        { x: 10, y: 20 },
      ]),
    ).toEqual({ x: 5, y: 10 });
  });

  it("a conduit end on a clustered element is drawn at the cluster centre", () => {
    load([item("a", 0, 0), item("b", 20, 0)]);
    setClusters(buildClusters(1));
    expect(displayPos({ x: 0, y: 0, at: "a" })).toEqual({ x: 10, y: 0 });
    // Unbound or unclustered points keep their real place — state never moves.
    expect(displayPos({ x: 7, y: 8 })).toEqual({ x: 7, y: 8 });
    expect(displayPos({ x: 7, y: 8, at: "nope" })).toEqual({ x: 7, y: 8, at: "nope" });
  });
});
