import assert from "node:assert/strict";
import test from "node:test";

import { layoutDiagram, type DiagramLayout, type LaidOutNode } from "../shared/diagram-layout.js";
import type { Diagram, DiagramKind, DiagramNode, NodeShape, NodeStatus } from "../shared/schemas/analysis.schema.js";

interface NodeSpec {
  id: string;
  label?: string;
  shape?: NodeShape;
  status?: NodeStatus;
  layer?: string;
  detail?: string;
  path?: string;
}

function diagram(kind: DiagramKind, nodes: NodeSpec[], links: Array<[string, string, string?]>, layers: string[] = []): Diagram {
  return {
    id: `d_${kind}`,
    title: kind,
    kind,
    layers,
    nodes: nodes.map(
      (spec): DiagramNode => ({
        id: spec.id,
        label: spec.label ?? spec.id,
        shape: spec.shape ?? "box",
        status: spec.status ?? "existing",
        layer: spec.layer ?? null,
        detail: spec.detail ?? null,
        location: spec.path ? { path: spec.path, line: null } : null,
      })
    ),
    links: links.map(([from, to, label]) => ({ from, to, label: label ?? null })),
    updatedAt: "2026-09-29T10:00:00.000Z",
  };
}

/** Schéma de la maquette 4 : périmètre d'impact en quatre couches. */
function impactLayers(): Diagram {
  const file = (id: string, layer: string, status: NodeStatus) => ({ id, label: id, layer, status, path: `src/${id}` });
  return diagram(
    "layers",
    [
      file("token.ts", "Données", "modified"),
      file("tokenStore.ts", "Données", "modified"),
      file("config.ts", "Données", "modified"),
      file("refreshService.ts", "Service", "new"),
      file("refresh.spec.ts", "Service", "new"),
      file("httpClient.ts", "Transport", "modified"),
      file("retry.ts", "Transport", "new"),
      file("documents.ts", "Appelants", "modified"),
      file("users.ts", "Appelants", "modified"),
      file("admin.ts", "Appelants", "impacted"),
      file("session.ts", "Appelants", "modified"),
      file("session.spec.ts", "Appelants", "modified"),
    ],
    [
      ["token.ts", "refreshService.ts"],
      ["tokenStore.ts", "refreshService.ts"],
      ["config.ts", "refreshService.ts"],
      ["refreshService.ts", "httpClient.ts"],
      ["refreshService.ts", "retry.ts"],
      ["refreshService.ts", "refresh.spec.ts"],
      ["httpClient.ts", "documents.ts"],
      ["httpClient.ts", "users.ts"],
      ["httpClient.ts", "admin.ts"],
      ["httpClient.ts", "session.ts"],
      ["session.ts", "session.spec.ts"],
    ],
    ["Données", "Service", "Transport", "Appelants"]
  );
}

/** Schéma de la maquette 5 : flux de rafraîchissement. */
function refreshFlow(): Diagram {
  return diagram(
    "flow",
    [
      { id: "request", label: "Requête API", shape: "pill" },
      { id: "is401", label: "401 ?", shape: "decision", status: "modified" },
      { id: "refresh", label: "refresh()", status: "new", path: "src/refreshService.ts" },
      { id: "forward", label: "Réponse transmise" },
      { id: "post", label: "POST /token", status: "new", path: "src/httpClient.ts" },
      { id: "success", label: "Succès ?", shape: "decision", status: "modified" },
      { id: "replay", label: "Rejouer la requête", status: "new" },
      { id: "null", label: "Renvoie null", status: "finding", path: "src/refreshService.ts" },
      { id: "end", label: "Fin", shape: "pill" },
      { id: "logout", label: "Déconnexion après 3 échecs", status: "missing", detail: "absente, demandée par TM-142" },
    ],
    [
      ["request", "is401"],
      ["is401", "refresh", "oui"],
      ["is401", "forward", "non"],
      ["refresh", "post"],
      ["post", "success"],
      ["success", "replay", "oui"],
      ["success", "null", "non"],
      ["replay", "end"],
      ["null", "logout", "attendu"],
    ]
  );
}

/** Carte mentale de douze nœuds sur trois niveaux. */
function conceptMap(): Diagram {
  return diagram(
    "mindmap",
    [
      { id: "root", label: "Rafraîchissement OAuth", shape: "pill", status: "new" },
      { id: "tokens", label: "Tokens" },
      { id: "access", label: "Token d'accès", status: "modified" },
      { id: "refreshToken", label: "Token de rafraîchissement", status: "new" },
      { id: "storage", label: "Stockage chiffré", status: "impacted" },
      { id: "network", label: "Réseau" },
      { id: "retry", label: "retry.ts", status: "new", path: "src/retry.ts" },
      { id: "client", label: "httpClient.ts", status: "modified", path: "src/httpClient.ts" },
      { id: "errors", label: "Erreurs", status: "finding" },
      { id: "logout", label: "Déconnexion", status: "missing", detail: "après 3 échecs" },
      { id: "nullReturn", label: "Renvoie null", status: "finding" },
      { id: "tests", label: "Tests", status: "new" },
    ],
    [
      ["root", "tokens"],
      ["tokens", "access"],
      ["tokens", "refreshToken"],
      ["refreshToken", "storage"],
      ["root", "network"],
      ["network", "retry"],
      ["network", "client"],
      ["root", "errors"],
      ["errors", "logout"],
      ["errors", "nullReturn"],
      ["root", "tests"],
    ]
  );
}

function overlaps(a: LaidOutNode, b: LaidOutNode): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function assertNoOverlap(layout: DiagramLayout) {
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      assert.ok(!overlaps(layout.nodes[i], layout.nodes[j]), `${layout.nodes[i].id} overlaps ${layout.nodes[j].id}`);
    }
  }
}

function assertWithinBounds(layout: DiagramLayout) {
  const inside = (x: number, y: number, what: string) => {
    assert.ok(x >= 0 && x <= layout.width, `${what}: x=${x} outside [0, ${layout.width}]`);
    assert.ok(y >= 0 && y <= layout.height, `${what}: y=${y} outside [0, ${layout.height}]`);
  };
  for (const node of layout.nodes) {
    inside(node.x, node.y, node.id);
    inside(node.x + node.width, node.y + node.height, node.id);
  }
  for (const link of layout.links) {
    for (const point of link.points) inside(point.x, point.y, `${link.from} -> ${link.to}`);
    inside(link.labelPosition.x, link.labelPosition.y, `label ${link.from} -> ${link.to}`);
  }
  for (const header of layout.headers) {
    inside(header.x, header.y, header.label);
    inside(header.x + header.width, header.y, header.label);
  }
}

function nodeOf(layout: DiagramLayout, id: string): LaidOutNode {
  const node = layout.nodes.find((entry) => entry.id === id);
  assert.ok(node, `node ${id} is laid out`);
  return node;
}

const FIXTURES: Array<[string, () => Diagram]> = [
  ["layers (maquette 4)", impactLayers],
  ["flow (maquette 5)", refreshFlow],
  ["mindmap (12 nœuds)", conceptMap],
];

for (const [name, make] of FIXTURES) {
  test(`diagram layout ${name}: no overlap, within bounds, deterministic`, () => {
    const layout = layoutDiagram(make());
    assert.equal(layout.nodes.length, make().nodes.length);
    assert.equal(layout.links.length, make().links.length);
    assertNoOverlap(layout);
    assertWithinBounds(layout);
    assert.deepEqual(layoutDiagram(make()), layout);
  });
}

// --- flow ------------------------------------------------------------------------

test("flow layout: forward links go left to right, from the right of the source to the left of the target", () => {
  const layout = layoutDiagram(refreshFlow());
  for (const link of layout.links) {
    assert.equal(link.back, false);
    const from = nodeOf(layout, link.from);
    const to = nodeOf(layout, link.to);
    assert.ok(from.x + from.width <= to.x, `${link.from} is left of ${link.to}`);
    assert.deepEqual(link.points[0], { x: from.x + from.width, y: from.y + from.height / 2 });
    assert.deepEqual(link.points[link.points.length - 1], { x: to.x, y: to.y + to.height / 2 });
  }
  const decision = nodeOf(layout, "is401");
  assert.equal(decision.width, 84);
  assert.equal(decision.height, 84);
  assert.equal(nodeOf(layout, "request").height, 40);
  assert.ok(nodeOf(layout, "refresh").width >= 140 && nodeOf(layout, "refresh").height === 44);
});

test("flow layout: the main branch stays on one line", () => {
  const layout = layoutDiagram(refreshFlow());
  const centerY = (id: string) => nodeOf(layout, id).y + nodeOf(layout, id).height / 2;
  for (const id of ["is401", "refresh", "post", "success", "replay"]) {
    assert.ok(Math.abs(centerY(id) - centerY("request")) < 2, `${id} is aligned with the request`);
  }
});

test("flow layout: a cycle is laid out, its back edge is flagged and routed below the nodes", () => {
  const cyclic = diagram(
    "flow",
    [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    [
      ["a", "b"],
      ["b", "c"],
      ["c", "a", "retry"],
      ["c", "d"],
    ]
  );
  const layout = layoutDiagram(cyclic);
  assert.equal(layout.nodes.length, 4);
  assertNoOverlap(layout);
  assertWithinBounds(layout);
  const backLinks = layout.links.filter((link) => link.back);
  assert.deepEqual(
    backLinks.map((link) => `${link.from}->${link.to}`),
    ["c->a"]
  );
  const bottom = Math.max(...layout.nodes.map((node) => node.y + node.height));
  assert.ok(Math.max(...backLinks[0].points.map((point) => point.y)) > bottom);
  for (const link of layout.links.filter((entry) => !entry.back)) {
    assert.ok(nodeOf(layout, link.from).x < nodeOf(layout, link.to).x);
  }
});

test("flow layout: a two-node cycle and a self loop do not hang", () => {
  const layout = layoutDiagram(
    diagram(
      "flow",
      [{ id: "a" }, { id: "b" }],
      [
        ["a", "b"],
        ["b", "a"],
        ["b", "b", "again"],
      ]
    )
  );
  assert.equal(layout.nodes.length, 2);
  assert.deepEqual(
    layout.links.map((link) => link.back),
    [false, true, true]
  );
  assertWithinBounds(layout);
});

test("flow layout: a link that skips ranks goes around the nodes of the ranks it crosses", () => {
  const layout = layoutDiagram(
    diagram(
      "flow",
      [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "d"],
        ["a", "d"],
      ]
    )
  );
  const skip = layout.links[3];
  const b = nodeOf(layout, "b");
  const c = nodeOf(layout, "c");
  for (let i = 1; i < skip.points.length; i++) {
    const p = skip.points[i - 1];
    const q = skip.points[i];
    for (const box of [b, c]) {
      const crossesX = Math.min(p.x, q.x) < box.x + box.width && Math.max(p.x, q.x) > box.x;
      const crossesY = Math.min(p.y, q.y) < box.y + box.height && Math.max(p.y, q.y) > box.y;
      assert.ok(!(crossesX && crossesY), `segment ${i} crosses a node`);
    }
  }
});

// --- layers ----------------------------------------------------------------------

test("layers layout: columns follow the layers order and every node sits in its column", () => {
  const source = impactLayers();
  const layout = layoutDiagram(source);
  assert.deepEqual(
    layout.headers.map((header) => header.label),
    source.layers
  );
  for (let i = 1; i < layout.headers.length; i++) {
    assert.ok(layout.headers[i].x >= layout.headers[i - 1].x + layout.headers[i - 1].width);
  }
  for (const node of source.nodes) {
    const header = layout.headers[source.layers.indexOf(node.layer!)];
    const box = nodeOf(layout, node.id);
    assert.ok(box.x >= header.x && box.x + box.width <= header.x + header.width, `${node.id} is inside ${header.label}`);
    assert.ok(box.y > header.y, `${node.id} is below its header`);
  }
});

test("layers layout: links run side to side between columns and top to bottom within a column", () => {
  const layout = layoutDiagram(impactLayers());
  const cross = layout.links.find((link) => link.from === "token.ts")!;
  const token = nodeOf(layout, "token.ts");
  const service = nodeOf(layout, "refreshService.ts");
  assert.deepEqual(cross.points[0], { x: token.x + token.width, y: token.y + token.height / 2 });
  assert.deepEqual(cross.points[cross.points.length - 1], { x: service.x, y: service.y + service.height / 2 });

  const inner = layout.links.find((link) => link.from === "session.ts")!;
  const session = nodeOf(layout, "session.ts");
  const spec = nodeOf(layout, "session.spec.ts");
  assert.ok(spec.y > session.y, "the test file sits below its source");
  assert.deepEqual(inner.points, [
    { x: session.x + session.width / 2, y: session.y + session.height },
    { x: spec.x + spec.width / 2, y: spec.y },
  ]);
});

test("layers layout: a node outside the declared layers is an explicit error", () => {
  const bad = diagram("layers", [{ id: "a", layer: "GUI" }, { id: "b", layer: "API" }], [["a", "b"]], ["GUI"]);
  assert.throws(() => layoutDiagram(bad), /couche « API », absente des couches déclarées \(GUI\)/);
  const missing = diagram("layers", [{ id: "a" }], [], ["GUI"]);
  assert.throws(() => layoutDiagram(missing), /n'a pas de couche/);
});

// --- mindmap ---------------------------------------------------------------------

test("mindmap layout: the root is at the centre and every node is further out than its parent", () => {
  const source = conceptMap();
  const layout = layoutDiagram(source);
  const center = (id: string) => {
    const node = nodeOf(layout, id);
    return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  };
  const root = center("root");
  assert.ok(Math.abs(root.x - layout.width / 2) < 1 && Math.abs(root.y - layout.height / 2) < 1);
  const distance = (id: string) => Math.hypot(center(id).x - root.x, center(id).y - root.y);
  for (const link of source.links) {
    assert.ok(distance(link.to) > distance(link.from), `${link.to} is further out than ${link.from}`);
  }
});

test("mindmap layout: links are clipped to the node borders", () => {
  const layout = layoutDiagram(conceptMap());
  for (const link of layout.links) {
    const [start, end] = [link.points[0], link.points[link.points.length - 1]];
    const from = nodeOf(layout, link.from);
    const to = nodeOf(layout, link.to);
    const onBorder = (box: LaidOutNode, p: { x: number; y: number }) =>
      p.x >= box.x - 0.01 && p.x <= box.x + box.width + 0.01 && p.y >= box.y - 0.01 && p.y <= box.y + box.height + 0.01;
    assert.ok(onBorder(from, start), `${link.from} start on its border`);
    assert.ok(onBorder(to, end), `${link.to} end on its border`);
  }
});

test("mindmap layout: the root is the first node without an incoming link", () => {
  const layout = layoutDiagram(diagram("mindmap", [{ id: "leaf" }, { id: "hub" }, { id: "other" }], [["hub", "leaf"], ["hub", "other"]]));
  const hub = nodeOf(layout, "hub");
  assert.ok(Math.abs(hub.x + hub.width / 2 - layout.width / 2) < 1);
  assert.ok(Math.abs(hub.y + hub.height / 2 - layout.height / 2) < 1);
});

// --- cas limites -------------------------------------------------------------------

for (const kind of ["flow", "layers", "mindmap"] as const) {
  const layers = kind === "layers" ? ["A", "B"] : [];
  const layer = kind === "layers" ? "A" : undefined;

  test(`${kind} layout: a single node`, () => {
    const layout = layoutDiagram(diagram(kind, [{ id: "only", layer }], [], layers));
    assert.equal(layout.nodes.length, 1);
    assertWithinBounds(layout);
    assert.equal(layout.nodes[0].x, 24);
  });

  test(`${kind} layout: unlinked nodes and duplicate parallel links`, () => {
    const layout = layoutDiagram(
      diagram(
        kind,
        [
          { id: "a", layer },
          { id: "b", layer: kind === "layers" ? "B" : undefined },
          { id: "alone", layer },
          { id: "c", layer },
        ],
        [
          ["a", "b", "x"],
          ["a", "b", "x"],
          ["b", "c"],
        ],
        layers
      )
    );
    assert.equal(layout.nodes.length, 4);
    assert.equal(layout.links.length, 3);
    assertNoOverlap(layout);
    assertWithinBounds(layout);
    assert.notDeepEqual(layout.links[0].labelPosition, layout.links[1].labelPosition);
  });
}

test("layout: an empty diagram or a link to an unknown node is an explicit error", () => {
  assert.throws(() => layoutDiagram(diagram("flow", [], [])), /ne contient aucun nœud/);
  assert.throws(() => layoutDiagram(diagram("flow", [{ id: "a" }], [["a", "ghost"]])), /nœud « ghost », absent/);
});
