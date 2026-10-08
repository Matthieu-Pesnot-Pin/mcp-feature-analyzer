import assert from "node:assert/strict";
import test from "node:test";

import { assertInvariants, assertSnapshotFieldsUnchanged, findInvariantViolations } from "../src/core/invariants.js";
import type { Diagram, Note } from "../shared/schemas/analysis.schema.js";
import { sampleAnalysis, sampleFinding } from "./helpers.js";

function diagram(overrides: Partial<Diagram> = {}): Diagram {
  return {
    id: "d_1",
    title: "Flow",
    kind: "flow",
    layers: [],
    nodes: [
      { id: "a", label: "A", shape: "box", status: "new", layer: null, detail: null, location: null },
      { id: "b", label: "B", shape: "pill", status: "existing", layer: null, detail: null, location: { path: "lib/other.ts", line: null } },
    ],
    links: [{ from: "a", to: "b", label: null }],
    updatedAt: "2026-09-29T10:00:00.000Z",
    ...overrides,
  };
}

const note = (id: string, findingId: string | null = null): Note => ({
  id,
  location: null,
  findingId,
  text: "Note",
  createdAt: "2026-09-29T10:00:00.000Z",
});

test("a consistent analysis has no violation", () => {
  const analysis = sampleAnalysis({
    findings: [
      sampleFinding(),
      sampleFinding({ id: "f_gap", kind: "requirement_gap", location: null, anchorText: null }),
    ],
    notes: [note("n_1"), note("n_2", "f_1")],
    diagrams: [diagram()],
    review: {
      state: "submitted",
      decision: "request_changes",
      selectedFindingIds: ["f_1"],
      selectedNoteIds: ["n_1"],
      prompt: "x",
      submittedAt: "2026-09-29T11:00:00.000Z",
    },
  });
  assert.deepEqual(findInvariantViolations(analysis), []);
  assert.doesNotThrow(() => assertInvariants(analysis));
});

test("ids are unique within each list and within a diagram", () => {
  const analysis = sampleAnalysis({
    findings: [sampleFinding(), sampleFinding()],
    notes: [note("n_1"), note("n_1")],
    diagrams: [diagram(), diagram({ nodes: [...diagram().nodes, diagram().nodes[0]] })],
  });
  const problems = findInvariantViolations(analysis);
  assert.ok(problems.includes('duplicate finding id "f_1"'));
  assert.ok(problems.includes('duplicate note id "n_1"'));
  assert.ok(problems.includes('duplicate diagram id "d_1"'));
  assert.ok(problems.includes('diagram "d_1" has duplicate node id "a"'));
});

test("a note answers an existing finding", () => {
  const analysis = sampleAnalysis({ findings: [sampleFinding()], notes: [note("n_1", "f_gone")] });
  assert.ok(findInvariantViolations(analysis).includes('note "n_1" answers unknown finding "f_gone"'));
});

test("an open finding must target a changed file, with available content and lines in range", () => {
  const problems = findInvariantViolations(
    sampleAnalysis({
      findings: [
        sampleFinding({ id: "f_missing", location: { path: "nope.ts", startLine: 1, endLine: 1 } }),
        sampleFinding({ id: "f_binary", location: { path: "img.png", startLine: 1, endLine: 1 } }),
        sampleFinding({ id: "f_range", location: { path: "src/a.ts", startLine: 5, endLine: 6 } }),
        sampleFinding({ id: "f_order", location: { path: "src/a.ts", startLine: 3, endLine: 2 } }),
      ],
    })
  );
  assert.deepEqual(problems, [
    'finding "f_missing" targets "nope.ts", which is not a changed file of this analysis',
    'finding "f_binary" targets lines of "img.png", whose content is not available',
    'finding "f_range" targets lines 5-6 of "src/a.ts", which has 5 line(s)',
    'finding "f_order" has startLine 3 after endLine 2',
  ]);
});

test("ignored and outdated findings keep a location the snapshot no longer has", () => {
  const analysis = sampleAnalysis({
    findings: [
      sampleFinding({ id: "f_out", status: "outdated", location: { path: "gone.ts", startLine: 1, endLine: 1 } }),
      sampleFinding({ id: "f_ign", status: "ignored", location: { path: "src/a.ts", startLine: 9, endLine: 9 } }),
    ],
  });
  assert.deepEqual(findInvariantViolations(analysis), []);
});

test("only requirement_gap findings may lack a location; anchorText and suggestion follow the location", () => {
  const problems = findInvariantViolations(
    sampleAnalysis({
      findings: [
        sampleFinding({ id: "f_issue", location: null, anchorText: null }),
        sampleFinding({ id: "f_gap", kind: "requirement_gap", location: null, anchorText: "x", suggestion: "y" }),
        sampleFinding({ id: "f_anchor", anchorText: null }),
      ],
    })
  );
  assert.deepEqual(problems, [
    'finding "f_issue" is an issue and needs a location (only requirement_gap findings may have none)',
    'finding "f_gap" has anchorText but no location',
    'finding "f_gap" has a suggestion but no location to replace',
    'finding "f_anchor" has a location but no anchorText',
  ]);
});

test("diagram links reference existing nodes and layers diagrams place every node in a declared layer", () => {
  const problems = findInvariantViolations(
    sampleAnalysis({
      diagrams: [
        diagram({ links: [{ from: "a", to: "zz", label: null }] }),
        diagram({
          id: "d_layers",
          kind: "layers",
          layers: ["UI", "API", "UI"],
          nodes: [
            { id: "a", label: "A", shape: "box", status: "new", layer: "UI", detail: null, location: null },
            { id: "b", label: "B", shape: "box", status: "new", layer: "DB", detail: null, location: null },
            { id: "c", label: "C", shape: "box", status: "new", layer: null, detail: null, location: null },
          ],
          links: [],
        }),
      ],
    })
  );
  assert.deepEqual(problems, [
    'diagram "d_1" has a link a -> zz to unknown node "zz"',
    'diagram "d_layers" declares layer "UI" twice',
    'diagram "d_layers" node "b" uses layer "DB", which is not in layers [UI, API, UI]',
    'diagram "d_layers" node "c" needs a layer (kind is layers)',
  ]);
});

test("the review only selects existing findings and notes, and its state is coherent", () => {
  const problems = findInvariantViolations(
    sampleAnalysis({
      review: {
        state: "submitted",
        decision: null,
        selectedFindingIds: ["f_x"],
        selectedNoteIds: ["n_x"],
        prompt: null,
        submittedAt: null,
      },
    })
  );
  assert.deepEqual(problems, [
    'review selects unknown finding "f_x"',
    'review selects unknown note "n_x"',
    "a submitted review needs a decision and a submittedAt date",
  ]);
  assert.throws(
    () => assertInvariants(sampleAnalysis({ findings: [sampleFinding(), sampleFinding()] })),
    /Analysis "sample-abc123" would become inconsistent: duplicate finding id "f_1"\./
  );
});

test("snapshot fields cannot change outside a snapshot refresh, reviewed flags can", () => {
  const before = sampleAnalysis();
  const reviewed = structuredClone(before);
  reviewed.files[0].reviewed = true;
  reviewed.title = "Renamed";
  assert.doesNotThrow(() => assertSnapshotFieldsUnchanged(before, reviewed));

  const tampered = structuredClone(before);
  tampered.headCommit = "c".repeat(40);
  tampered.files.pop();
  assert.throws(() => assertSnapshotFieldsUnchanged(before, tampered), /Cannot change headCommit, files of analysis/);
});

test("the refs match the mode of the analysis", () => {
  const branch = sampleAnalysis({ mode: "branch", base: "master", head: null, headCommit: null });
  assert.deepEqual(findInvariantViolations(branch), ["a branch analysis needs a head ref and a head commit"]);
  const workingTree = sampleAnalysis({ mode: "working_tree", base: "master", head: "feat", headCommit: "abc1234" });
  assert.deepEqual(findInvariantViolations(workingTree), ['a working_tree analysis has base "HEAD" and no head ref nor head commit']);
  const consistent = sampleAnalysis({ mode: "working_tree", base: "HEAD", head: null, headCommit: null });
  assert.deepEqual(findInvariantViolations(consistent), []);
});
