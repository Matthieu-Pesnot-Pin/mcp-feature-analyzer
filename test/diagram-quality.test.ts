import assert from "node:assert/strict";
import test from "node:test";

import { layoutDiagram, type DiagramLayout, type Point } from "../shared/diagram-layout.js";
import { diagramQuality, isClean } from "../shared/diagram-quality.js";
import type { Diagram } from "../shared/schemas/analysis.schema.js";
import { conceptMap, diagram, impactLayers, refreshFlow } from "./diagram-fixtures.js";

/** Placement construit à la main : nœuds de 20 × 20 et tracés donnés, dans l'ordre des liens. */
function handLayout(source: Diagram, positions: Record<string, [number, number]>, routes: Point[][]): DiagramLayout {
  return {
    nodes: source.nodes.map((node) => ({ id: node.id, x: positions[node.id][0], y: positions[node.id][1], width: 20, height: 20 })),
    links: source.links.map((link, index) => ({
      from: link.from,
      to: link.to,
      points: routes[index],
      labelPosition: routes[index][0],
      labelAnchor: "middle",
      back: false,
    })),
    headers: [],
    width: 400,
    height: 400,
  };
}

const describe = (quality: ReturnType<typeof diagramQuality>) => ({
  crossings: quality.crossings.map(({ a, b }) => `${a.index}:${a.from}->${a.to} x ${b.index}:${b.from}->${b.to}`),
  nodeOverlaps: quality.nodeOverlaps.map(({ link, node }) => `${link.index}:${link.from}->${link.to} through ${node}`),
});

test("diagramQuality: two links between four distinct nodes that cross are reported, with their index", () => {
  const source = diagram("flow", [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], [["a", "b"], ["c", "d"]]);
  const layout = handLayout(source, { a: [0, 0], b: [200, 200], c: [0, 200], d: [200, 0] }, [
    [{ x: 20, y: 10 }, { x: 200, y: 210 }],
    [{ x: 20, y: 210 }, { x: 200, y: 10 }],
  ]);
  assert.deepEqual(describe(diagramQuality(source, layout)), { crossings: ["0:a->b x 1:c->d"], nodeOverlaps: [] });
});

test("diagramQuality: links that share a node may join or share a trunk there, but a clean cut still counts", () => {
  const source = diagram(
    "flow",
    [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    [
      ["a", "b"],
      ["a", "c"],
      ["d", "b"],
      ["a", "d"],
    ]
  );
  const layout = handLayout(source, { a: [0, 100], b: [300, 0], c: [300, 200], d: [150, 300] }, [
    // a -> b et a -> c partent sur le même tronçon puis s'écartent : aucun croisement.
    [{ x: 20, y: 110 }, { x: 100, y: 110 }, { x: 100, y: 10 }, { x: 300, y: 10 }],
    [{ x: 20, y: 110 }, { x: 100, y: 110 }, { x: 100, y: 210 }, { x: 300, y: 210 }],
    // d -> b arrive sur b en coupant franchement a -> c, avec qui il ne partage aucun nœud.
    [{ x: 160, y: 300 }, { x: 160, y: 20 }, { x: 300, y: 20 }],
    // a -> d rejoint d -> b en d, leur nœud commun : aucun croisement.
    [{ x: 20, y: 120 }, { x: 160, y: 300 }],
  ]);
  assert.deepEqual(describe(diagramQuality(source, layout)), {
    crossings: ["1:a->c x 2:d->b"],
    nodeOverlaps: [],
  });

  const sharedCut = diagram("flow", [{ id: "a" }, { id: "b" }, { id: "c" }], [["a", "b"], ["a", "c"]]);
  const cut = handLayout(sharedCut, { a: [0, 100], b: [300, 0], c: [300, 200] }, [
    [{ x: 20, y: 110 }, { x: 150, y: 110 }, { x: 150, y: 210 }, { x: 250, y: 210 }, { x: 250, y: 10 }, { x: 300, y: 10 }],
    [{ x: 20, y: 110 }, { x: 100, y: 110 }, { x: 100, y: 150 }, { x: 300, y: 150 }, { x: 300, y: 210 }],
  ]);
  assert.deepEqual(describe(diagramQuality(sharedCut, cut)).crossings, ["0:a->b x 1:a->c"]);
});

test("diagramQuality: a link through a node it does not connect is reported, one that grazes a border is not", () => {
  const source = diagram("flow", [{ id: "a" }, { id: "b" }, { id: "mid" }, { id: "edge" }], [["a", "b"]]);
  const through = handLayout(source, { a: [0, 100], b: [300, 100], mid: [150, 100], edge: [150, 300] }, [
    [{ x: 20, y: 110 }, { x: 300, y: 110 }],
  ]);
  assert.deepEqual(describe(diagramQuality(source, through)), { crossings: [], nodeOverlaps: ["0:a->b through mid"] });

  const grazing = handLayout(source, { a: [0, 100], b: [300, 100], mid: [150, 110], edge: [150, 300] }, [
    [{ x: 20, y: 110 }, { x: 300, y: 110 }],
  ]);
  assert.ok(isClean(diagramQuality(source, grazing)));
});

test("diagramQuality: maquette 4, maquette 5 and a ten-node mindmap tree have no crossing", () => {
  const tree = diagram(
    "mindmap",
    [{ id: "root", shape: "pill" }, { id: "a" }, { id: "a1" }, { id: "a2" }, { id: "b" }, { id: "b1" }, { id: "b2" }, { id: "b3" }, { id: "c" }, { id: "c1" }],
    [
      ["root", "a"],
      ["a", "a1"],
      ["a", "a2"],
      ["root", "b"],
      ["b", "b1"],
      ["b", "b2"],
      ["b", "b3"],
      ["root", "c"],
      ["c", "c1"],
    ]
  );
  for (const source of [impactLayers(), refreshFlow(), conceptMap(), tree]) {
    assert.deepEqual(describe(diagramQuality(source)), { crossings: [], nodeOverlaps: [] }, source.title);
  }
});

test("diagramQuality: a complete bipartite layers diagram (K3,3) reports its unavoidable crossings", () => {
  const k33 = diagram(
    "layers",
    [
      { id: "a1", layer: "A" },
      { id: "a2", layer: "A" },
      { id: "a3", layer: "A" },
      { id: "b1", layer: "B" },
      { id: "b2", layer: "B" },
      { id: "b3", layer: "B" },
    ],
    ["a1", "a2", "a3"].flatMap((a) => ["b1", "b2", "b3"].map((b): [string, string] => [a, b])),
    ["A", "B"]
  );
  const quality = diagramQuality(k33);
  // Deux colonnes et neuf liens droits : quel que soit l'ordre, chaque paire de sources croise chaque paire de cibles.
  assert.equal(quality.crossings.length, 9);
  assert.equal(quality.nodeOverlaps.length, 0);
  for (const { a, b } of quality.crossings) {
    assert.ok(a.index < b.index);
    for (const ref of [a, b]) assert.deepEqual([ref.from, ref.to], [k33.links[ref.index].from, k33.links[ref.index].to]);
  }
});

test("layout: nodes declared in a crossing order are reordered to remove the crossings", () => {
  const tangled = diagram(
    "layers",
    [
      { id: "a1", layer: "A" },
      { id: "a2", layer: "A" },
      { id: "a3", layer: "A" },
      { id: "b1", layer: "B" },
      { id: "b2", layer: "B" },
      { id: "b3", layer: "B" },
      { id: "c1", layer: "C" },
      { id: "c2", layer: "C" },
      { id: "c3", layer: "C" },
    ],
    [
      ["a1", "b3"],
      ["a2", "b1"],
      ["a3", "b2"],
      ["b1", "c2"],
      ["b2", "c3"],
      ["b3", "c1"],
    ],
    ["A", "B", "C"]
  );
  // Dans l'ordre de déclaration, deux liens entre colonnes voisines se croisent quand leurs extrémités sont inversées.
  const rank = (id: string) => Number(id.slice(1));
  let declared = 0;
  for (let i = 0; i < tangled.links.length; i++) {
    for (let j = i + 1; j < tangled.links.length; j++) {
      const [p, q] = [tangled.links[i], tangled.links[j]];
      if (p.from[0] !== q.from[0]) continue;
      if ((rank(p.from) - rank(q.from)) * (rank(p.to) - rank(q.to)) < 0) declared++;
    }
  }
  assert.equal(declared, 4);
  assert.deepEqual(describe(diagramQuality(tangled)), { crossings: [], nodeOverlaps: [] });

  // Liens internes à une colonne et liens qui sautent une colonne : l'ordre retenu ne laisse aucun problème.
  const mixed = diagram(
    "layers",
    [
      { id: "n0", layer: "L0" },
      { id: "n1", layer: "L0" },
      { id: "n2", layer: "L1" },
      { id: "n3", layer: "L2" },
      { id: "n4", layer: "L1" },
      { id: "n5", layer: "L1" },
      { id: "n6", layer: "L1" },
      { id: "n7", layer: "L0" },
    ],
    [
      ["n0", "n5"],
      ["n1", "n4"],
      ["n4", "n3"],
      ["n0", "n7"],
      ["n1", "n5"],
      ["n6", "n2"],
      ["n0", "n1"],
      ["n7", "n0"],
    ],
    ["L0", "L1", "L2"]
  );
  assert.deepEqual(describe(diagramQuality(mixed)), { crossings: [], nodeOverlaps: [] });
});

test("layout: links that merge into the same node from one gap do not cross (flow channels)", () => {
  const flow = diagram(
    "flow",
    [
      { id: "start", shape: "pill" },
      { id: "auth", shape: "decision" },
      { id: "load" },
      { id: "deny" },
      { id: "cache", shape: "decision" },
      { id: "hit" },
      { id: "fetch" },
      { id: "store" },
      { id: "render" },
      { id: "end", shape: "pill" },
      { id: "log" },
    ],
    [
      ["start", "auth"],
      ["auth", "load", "ok"],
      ["auth", "deny", "ko"],
      ["load", "cache"],
      ["cache", "hit", "yes"],
      ["cache", "fetch", "no"],
      ["fetch", "store"],
      ["store", "render"],
      ["hit", "render"],
      ["render", "end"],
      ["deny", "log"],
      ["fetch", "log"],
    ]
  );
  const layout = layoutDiagram(flow);
  assert.deepEqual(describe(diagramQuality(flow, layout)), { crossings: [], nodeOverlaps: [] });
  assert.deepEqual(layoutDiagram(flow), layout, "the layout is deterministic");
});
