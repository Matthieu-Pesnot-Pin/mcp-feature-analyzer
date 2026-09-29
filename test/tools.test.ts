import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs";
import path from "node:path";

import type { AnalysisStore } from "../src/core/analysis-store.js";
import { errorResult, type Args, type MutationResult, type ToolResult } from "../src/tools/types.js";
import { createAnalysis } from "../src/tools/create-analysis.js";
import { listAnalyses } from "../src/tools/list-analyses.js";
import { getAnalysis } from "../src/tools/get-analysis.js";
import { getDiff } from "../src/tools/get-diff.js";
import { refreshAnalysis } from "../src/tools/refresh-analysis.js";
import { updateAnalysis } from "../src/tools/update-analysis.js";
import { addFindings } from "../src/tools/add-findings.js";
import { updateFinding } from "../src/tools/update-finding.js";
import { deleteFindings } from "../src/tools/delete-findings.js";
import { setDiagram } from "../src/tools/set-diagram.js";
import { deleteDiagram } from "../src/tools/delete-diagram.js";
import { getReviewFeedback } from "../src/tools/get-review-feedback.js";
import { deleteAnalysis } from "../src/tools/delete-analysis.js";
import { buildAgentPrompt } from "../shared/prompt.js";
import { git, makeGitRepo, makeStore } from "./helpers.js";

type Tool = (store: AnalysisStore, args: Args) => ToolResult | MutationResult | Promise<ToolResult | MutationResult>;

/** Appelle un outil comme le fait le serveur : une erreur devient un résultat `Error: …`. */
async function call(tool: Tool, store: AnalysisStore, args: Args): Promise<{ text: string; isError: boolean }> {
  let result: ToolResult;
  try {
    const out = await tool(store, args);
    result = "result" in out ? (out as MutationResult).result : (out as ToolResult);
  } catch (err) {
    result = errorResult((err as Error).message);
  }
  return { text: result.content.map((entry) => entry.text).join("\n"), isError: result.isError === true };
}

/** Appelle un outil qui doit réussir et renvoie son texte. */
async function ok(tool: Tool, store: AnalysisStore, args: Args): Promise<string> {
  const { text, isError } = await call(tool, store, args);
  assert.equal(isError, false, text);
  return text;
}

/** Appelle un outil qui doit échouer et renvoie son texte. */
async function fails(tool: Tool, store: AnalysisStore, args: Args): Promise<string> {
  const { text, isError } = await call(tool, store, args);
  assert.equal(isError, true, text);
  assert.match(text, /^Error: /);
  return text;
}

/** Store et dépôt temporaires, et une analyse `master...HEAD` sur la branche `feature`. */
async function setup(t: TestContext) {
  const repo = makeGitRepo();
  const temp = makeStore();
  t.after(() => {
    repo.cleanup();
    temp.cleanup();
  });
  const text = await ok(createAnalysis, temp.store, { repo_path: repo.dir, title: "Feature X", mode: "branch", base: "master" });
  const id = /\(id: ([a-z0-9-]+)\)/.exec(text)![1];
  return { repo: repo.dir, store: temp.store, id, createText: text };
}

// --- create_analysis / list_analyses -----------------------------------------

test("create_analysis freezes the branch diff and lists the changed files with next steps", async (t) => {
  const { store, id, createText } = await setup(t);
  assert.match(createText, /Created analysis "Feature X"/);
  assert.match(createText, /branch master\.\.\.HEAD/);
  assert.match(createText, /M src\/app\.ts {2}\+2 -1/);
  assert.match(createText, /A src\/new file\.ts/);
  assert.match(createText, /R docs\/old name\.md -> docs\/new name\.md/);
  assert.match(createText, /M logo\.bin {2}binary/);
  assert.match(createText, /get_diff/);
  assert.equal(store.get(id).head, "HEAD");
});

test("create_analysis reports a bad ref, a missing base and a misplaced head explicitly", async (t) => {
  const { repo, store } = await setup(t);
  assert.match(await fails(createAnalysis, store, { repo_path: repo, title: "X", mode: "branch", base: "nope" }), /Unknown base ref "nope"/);
  assert.match(await fails(createAnalysis, store, { repo_path: repo, title: "X", mode: "branch" }), /"base" is required in branch mode/);
  assert.match(
    await fails(createAnalysis, store, { repo_path: repo, title: "X", mode: "working_tree", head: "feature" }),
    /"head" is not accepted in working_tree mode/
  );
  assert.match(await fails(createAnalysis, store, { repo_path: repo, title: "X", mode: "both" }), /"mode" must be one of branch, working_tree/);
  assert.match(
    await fails(createAnalysis, store, { repo_path: repo, title: "X", mode: "branch", base: "master", request_source: "JIRA-1" }),
    /give "request_text" too/
  );
  assert.match(await fails(createAnalysis, store, { repo_path: repo, title: "X", mode: "branch", bse: "master" }), /Unknown field\(s\): bse/);
  assert.equal(store.list().analyses.length, 1);
});

test("create_analysis in working_tree mode includes untracked files", async (t) => {
  const { repo, store } = await setup(t);
  fs.writeFileSync(path.join(repo, "draft.txt"), "draft\n");
  const text = await ok(createAnalysis, store, { repo_path: repo, title: "WIP", mode: "working_tree" });
  assert.match(text, /working_tree/);
  assert.match(text, /A draft\.txt {2}\+1 -0/);
});

test("list_analyses points to create_analysis when empty, then lists analyses and unreadable files", async (t) => {
  const temp = makeStore();
  t.after(temp.cleanup);
  assert.match(await ok(listAnalyses, temp.store, {}), /No analyses yet\. Create one with create_analysis/);

  const { store, id } = await setup(t);
  await ok(addFindings, store, {
    analysis_id: id,
    findings: [{ severity: "major", title: "Bug", body: "Wrong", path: "src/app.ts", start_line: 2 }],
  });
  fs.writeFileSync(path.join(store.dataDir, "analyses", "broken-abc123.json"), "{ not json");
  const text = await ok(listAnalyses, store, {});
  assert.match(text, new RegExp(`- ${id} — "Feature X"`));
  assert.match(text, /files reviewed 0\/7 \| open findings: 1 major \| diagrams: 0/);
  assert.match(text, /review: pending/);
  assert.match(text, /1 analysis file\(s\) could not be read/);
  assert.match(text, /- broken-abc123: /);
});

// --- get_diff / get_analysis / update_analysis --------------------------------

test("get_diff shows old and new line numbers, and binary and deleted markers", async (t) => {
  const { store, id } = await setup(t);
  const one = await ok(getDiff, store, { analysis_id: id, path: "src/app.ts" });
  assert.match(one, /NEW-side numbers/);
  assert.match(one, /^ 2 \| {4}- line 2$/m);
  assert.match(one, /^ {3}\| {2}2 \+ line 2 changed$/m);
  assert.match(one, /^ {3}\| 26 \+ inserted after 25$/m);
  assert.doesNotMatch(one, /logo\.bin/);

  const all = await ok(getDiff, store, { analysis_id: id });
  assert.match(all, /\[binary file: no line-level diff/);
  assert.match(all, /\[deleted file: no new side/);
  assert.match(all, /\[renamed without content changes\]/);

  assert.match(await fails(getDiff, store, { analysis_id: id, path: "nope.ts" }), /File "nope\.ts" is not part of analysis/);
  assert.match(await fails(getDiff, store, { analysis_id: "missing-abc123" }), /Analysis "missing-abc123" not found\. Use list_analyses/);
});

test("update_analysis sets the summary and the request, and requires at least one field", async (t) => {
  const { store, id } = await setup(t);
  const text = await ok(updateAnalysis, store, {
    analysis_id: id,
    summary: ["Adds a thing", "Removes another"],
    request_text: "Please add a thing",
    request_source: "JIRA-42",
  });
  assert.match(text, /summary \(2 bullet\(s\)\), initial request/);
  const view = await ok(getAnalysis, store, { analysis_id: id });
  assert.match(view, /Initial request \(JIRA-42\):\nPlease add a thing/);
  assert.match(view, /Summary:\n- Adds a thing\n- Removes another/);

  await ok(updateAnalysis, store, { analysis_id: id, request_source: null });
  assert.deepEqual(store.get(id).request, { text: "Please add a thing", source: null });
  await ok(updateAnalysis, store, { analysis_id: id, request_text: null });
  assert.equal(store.get(id).request, null);

  assert.match(await fails(updateAnalysis, store, { analysis_id: id }), /Give at least one field to change/);
  assert.match(await fails(updateAnalysis, store, { analysis_id: id, summary: ["ok", ""] }), /"summary\[1\]" must be a non-empty string/);
});

// --- add_findings / update_finding / delete_findings --------------------------

test("add_findings resolves locations, keeps suggestions verbatim and returns the ids", async (t) => {
  const { store, id } = await setup(t);
  const text = await ok(addFindings, store, {
    analysis_id: id,
    findings: [
      { id: "f_bug", severity: "critical", title: "Bug", body: "Wrong value", path: "src/app.ts", start_line: 2, suggestion: "    line 2\n" },
      { severity: "minor", kind: "requirement_gap", title: "No logging", body: "Logging was requested" },
    ],
  });
  assert.match(text, /Added 2 finding\(s\)/);
  assert.match(text, /f_bug \[critical\] issue, open — src\/app\.ts:2 — Bug/);
  assert.match(text, /f_[a-z0-9]{6} \[minor\] requirement_gap, open — no location — No logging/);
  assert.match(text, /Open findings: 1 critical, 1 minor\./);

  const [bug, gap] = store.get(id).findings;
  assert.equal(bug.anchorText, "line 2 changed");
  assert.equal(bug.suggestion, "    line 2\n");
  assert.equal(gap.location, null);

  const view = await ok(getAnalysis, store, { analysis_id: id });
  assert.match(view, /Findings \(2: 2 open, 0 ignored, 0 outdated/);
});

test("add_findings is all-or-nothing and reports every invalid finding", async (t) => {
  const { store, id } = await setup(t);
  await ok(addFindings, store, { analysis_id: id, findings: [{ id: "taken", severity: "minor", title: "T", body: "B", path: "src/app.ts", start_line: 1 }] });

  const text = await fails(addFindings, store, {
    analysis_id: id,
    findings: [
      { severity: "major", title: "Valid", body: "B", path: "src/app.ts", start_line: 3 },
      { severity: "major", title: "Out", body: "B", path: "src/app.ts", start_line: 30, end_line: 40 },
      { severity: "urgent", title: "Bad severity", body: "B", kind: "requirement_gap" },
      { severity: "minor", title: "No location", body: "B" },
      { id: "taken", severity: "minor", title: "Dup", body: "B", path: "src/app.ts", start_line: 1 },
      { severity: "minor", title: "Binary", body: "B", path: "logo.bin", start_line: 1 },
    ],
  });
  assert.match(text, /No finding was added: 5 of 6 finding\(s\) are invalid/);
  assert.match(text, /findings\[1\]: Lines 30-40 are out of range for "src\/app\.ts", which has 31 line\(s\)/);
  assert.match(text, /findings\[2\]: "severity" must be one of critical, major, minor, trivial/);
  assert.match(text, /findings\[3\]: an issue needs a location/);
  assert.match(text, /findings\[4\]: id "taken" is already used/);
  assert.match(text, /findings\[5\]: Cannot anchor on lines of "logo\.bin".*binary/);
  assert.doesNotMatch(text, /findings\[0\]/);
  assert.equal(store.get(id).findings.length, 1);
});

test("update_finding edits agent fields, re-anchors, and does not expose the status", async (t) => {
  const { store, id } = await setup(t);
  await ok(addFindings, store, { analysis_id: id, findings: [{ id: "f1", severity: "minor", title: "T", body: "B", path: "src/app.ts", start_line: 1 }] });

  const text = await ok(updateFinding, store, {
    analysis_id: id,
    finding_id: "f1",
    severity: "major",
    path: "src/app.ts",
    start_line: 26,
    end_line: 27,
    prompt: "Remove the inserted line.",
  });
  assert.match(text, /Updated finding f1 \(severity, path, start_line, end_line, prompt\)/);
  assert.match(text, /f1 \[major\] issue, open — src\/app\.ts:26-27 — T/);
  const finding = store.get(id).findings[0];
  assert.equal(finding.anchorText, "inserted after 25\nline 26");
  assert.equal(finding.prompt, "Remove the inserted line.");

  await ok(updateFinding, store, { analysis_id: id, finding_id: "f1", prompt: null });
  assert.equal(store.get(id).findings[0].prompt, null);

  assert.match(await fails(updateFinding, store, { analysis_id: id, finding_id: "nope", title: "X" }), /Finding "nope" not found.*Existing findings: f1/);
  assert.match(await fails(updateFinding, store, { analysis_id: id, finding_id: "f1", status: "ignored" }), /Unknown field\(s\): status/);
  assert.match(await fails(updateFinding, store, { analysis_id: id, finding_id: "f1" }), /Give at least one field to change/);
  assert.match(await fails(updateFinding, store, { analysis_id: id, finding_id: "f1", path: null }), /issue without location/);
  assert.match(
    await fails(updateFinding, store, { analysis_id: id, finding_id: "f1", path: "src/app.ts", start_line: 99 }),
    /out of range for "src\/app\.ts"/
  );
});

test("delete_findings rejects unknown ids without deleting, and drops deleted ids from the review selection", async (t) => {
  const { store, id } = await setup(t);
  await ok(addFindings, store, {
    analysis_id: id,
    findings: [
      { id: "f1", severity: "minor", title: "A", body: "B", path: "src/app.ts", start_line: 1 },
      { id: "f2", severity: "minor", title: "C", body: "D", path: "src/app.ts", start_line: 2 },
    ],
  });
  store.mutate(id, "user", (draft) => {
    draft.review.selectedFindingIds = ["f1", "f2"];
  });

  assert.match(await fails(deleteFindings, store, { analysis_id: id, finding_ids: ["f1", "zz"] }), /No finding was deleted: unknown finding id\(s\) zz/);
  assert.equal(store.get(id).findings.length, 2);

  assert.match(await ok(deleteFindings, store, { analysis_id: id, finding_ids: ["f1"] }), /Deleted 1 finding\(s\).*f1\. 1 finding\(s\) remain/);
  const analysis = store.get(id);
  assert.deepEqual(analysis.findings.map((finding) => finding.id), ["f2"]);
  assert.deepEqual(analysis.review.selectedFindingIds, ["f2"]);
});

// --- set_diagram / delete_diagram ---------------------------------------------

test("set_diagram creates a layers diagram with defaults, then replaces it by id", async (t) => {
  const { store, id } = await setup(t);
  const text = await ok(setDiagram, store, {
    analysis_id: id,
    diagram_id: "impact",
    title: "Impact",
    kind: "layers",
    layers: ["GUI", "Core"],
    nodes: [
      { id: "ui", label: "Screen", layer: "GUI", status: "modified" },
      { id: "app", label: "app.ts", layer: "Core", path: "src/app.ts", line: 2 },
    ],
    links: [{ from: "ui", to: "app", label: "calls" }],
  });
  assert.match(text, /Created diagram impact "Impact" \(layers, 2 node\(s\), 1 link\(s\)\)/);
  const node = store.get(id).diagrams[0].nodes[1];
  assert.equal(node.shape, "box");
  assert.equal(node.status, "existing");
  assert.deepEqual(node.location, { path: "src/app.ts", line: 2 });

  const replaced = await ok(setDiagram, store, {
    analysis_id: id,
    diagram_id: "impact",
    title: "Flow",
    kind: "flow",
    nodes: [{ id: "start", label: "Start", shape: "pill" }],
  });
  assert.match(replaced, /Replaced diagram impact "Flow" \(flow, 1 node\(s\), 0 link\(s\)\)/);
  assert.equal(store.get(id).diagrams.length, 1);
  assert.match(await ok(getAnalysis, store, { analysis_id: id }), /impact — "Flow" \(flow, 1 node\(s\), 0 link\(s\)\)/);
});

test("set_diagram rejects undeclared layers, unknown link ends and bad node locations, and writes nothing", async (t) => {
  const { store, id } = await setup(t);
  const text = await fails(setDiagram, store, {
    analysis_id: id,
    title: "Impact",
    kind: "layers",
    layers: ["GUI"],
    nodes: [
      { id: "ui", label: "Screen", layer: "GUI" },
      { id: "db", label: "Storage", layer: "Storage" },
      { id: "out", label: "Outside", layer: "GUI", path: "src/other.ts" },
      { label: "No id", layer: "GUI" },
    ],
    links: [{ from: "ui", to: "ghost" }],
  });
  assert.match(text, /The diagram was not saved: 4 problem\(s\)/);
  assert.match(text, /nodes\[1\]: "nodes\[1\]\.layer" is "Storage", which is not declared in layers \(GUI\)/);
  assert.match(text, /nodes\[2\]: "src\/other\.ts" is not a changed file of this analysis/);
  assert.match(text, /nodes\[3\]: "nodes\[3\]\.id" is required/);
  assert.match(text, /links\[0\]: links ui -> ghost, but node\(s\) ghost are not in "nodes"/);

  assert.match(
    await fails(setDiagram, store, { analysis_id: id, title: "L", kind: "layers", nodes: [{ id: "a", label: "A" }] }),
    /"layers" is required when kind is layers/
  );
  assert.match(
    await fails(setDiagram, store, { analysis_id: id, title: "F", kind: "flow", layers: ["X"], nodes: [{ id: "a", label: "A" }] }),
    /"layers" is only used when kind is layers/
  );
  assert.equal(store.get(id).diagrams.length, 0);
});

test("delete_diagram removes a diagram and reports unknown ids", async (t) => {
  const { store, id } = await setup(t);
  await ok(setDiagram, store, { analysis_id: id, diagram_id: "d1", title: "Map", kind: "mindmap", nodes: [{ id: "root", label: "Root" }] });
  assert.match(await fails(deleteDiagram, store, { analysis_id: id, diagram_id: "d2" }), /Diagram "d2" not found.*Existing diagrams: d1/);
  assert.match(await ok(deleteDiagram, store, { analysis_id: id, diagram_id: "d1" }), /Deleted diagram d1 \("Map"\)/);
  assert.equal(store.get(id).diagrams.length, 0);
});

// --- get_review_feedback / refresh_analysis / delete_analysis ------------------

/** Soumet une revue comme le ferait la GUI : remarque, sélection, décision et prompt. */
function submitReview(store: AnalysisStore, id: string, findingIds: string[]) {
  store.mutate(id, "user", (draft) => {
    draft.notes.push({ id: "n1", location: { path: "src/app.ts", line: 2 }, text: "Rename this", createdAt: new Date().toISOString() });
    draft.review.state = "submitted";
    draft.review.decision = "request_changes";
    draft.review.selectedFindingIds = findingIds;
    draft.review.selectedNoteIds = ["n1"];
    draft.review.prompt = buildAgentPrompt(draft, { findingIds, noteIds: ["n1"], decision: "request_changes" });
    draft.review.submittedAt = new Date().toISOString();
  });
}

test("get_review_feedback reports progress before submission and the feedback after, without changing state", async (t) => {
  const { store, id } = await setup(t);
  await ok(addFindings, store, {
    analysis_id: id,
    findings: [{ id: "f1", severity: "major", title: "Bug", body: "Explain", path: "src/app.ts", start_line: 2, suggestion: "line 2" }],
  });
  store.mutate(id, "user", (draft) => {
    draft.files[0].reviewed = true;
  });

  const before = await ok(getReviewFeedback, store, { analysis_id: id });
  assert.match(before, /is not submitted yet/);
  assert.match(before, /Progress: 1\/7 file\(s\) reviewed, 0\/1 finding\(s\) ignored, 0 reviewer note\(s\)/);

  submitReview(store, id, ["f1"]);
  const revision = store.get(id).revision;
  const after = await ok(getReviewFeedback, store, { analysis_id: id });
  assert.match(after, /Decision: request_changes/);
  assert.match(after, /Selected findings \(1\):\n- f1 \[major\] issue, open — src\/app\.ts:2 — Bug\n {4}Explain\n {4}Proposed replacement:\n {6}line 2/);
  assert.match(after, /Selected reviewer notes \(1\):\n- n1 — src\/app\.ts:2\n {4}Rename this/);
  assert.ok(after.includes(store.get(id).review.prompt!), "the prompt must be quoted verbatim");
  assert.match(after, /refresh_analysis/);
  assert.equal(store.get(id).revision, revision);
});

test("refresh_analysis recomputes the diff, outdates changed findings and resets the review", async (t) => {
  const { repo, store, id } = await setup(t);
  await ok(addFindings, store, {
    analysis_id: id,
    findings: [
      { id: "f_changed", severity: "major", title: "Line 2", body: "B", path: "src/app.ts", start_line: 2 },
      { id: "f_same", severity: "minor", title: "Line 10", body: "B", path: "src/app.ts", start_line: 10 },
    ],
  });
  submitReview(store, id, ["f_changed"]);

  const appPath = path.join(repo, "src", "app.ts");
  fs.writeFileSync(appPath, fs.readFileSync(appPath, "utf-8").replace("line 2 changed", "line 2 fixed"));
  git(repo, "commit", "-q", "-am", "fix line 2");

  const text = await ok(refreshAnalysis, store, { analysis_id: id });
  assert.match(text, /Findings: 1 became outdated/);
  assert.match(text, /Review: the previous feedback \(decision request_changes, submitted at .+\) was discarded; the review is pending again\./);
  assert.match(text, /Outdated findings:\n {2}f_changed \[major\] Line 2/);

  const analysis = store.get(id);
  assert.deepEqual(analysis.review, {
    state: "pending",
    decision: null,
    selectedFindingIds: [],
    selectedNoteIds: [],
    prompt: null,
    submittedAt: null,
  });
  assert.deepEqual(analysis.findings.map((finding) => [finding.id, finding.status]), [
    ["f_changed", "outdated"],
    ["f_same", "open"],
  ]);
  assert.match(await ok(getReviewFeedback, store, { analysis_id: id }), /is not submitted yet/);

  const reopened = await ok(updateFinding, store, { analysis_id: id, finding_id: "f_changed", path: "src/app.ts", start_line: 2 });
  assert.match(reopened, /It was outdated; the new location reopened it\./);
  assert.equal(store.get(id).findings[0].anchorText, "line 2 fixed");
});

test("delete_analysis removes the analysis and its snapshot, and reports unknown ids", async (t) => {
  const { store, id } = await setup(t);
  assert.match(await ok(deleteAnalysis, store, { analysis_id: id }), new RegExp(`Deleted analysis ${id}`));
  assert.equal(fs.existsSync(store.snapshotPath(id)), false);
  assert.equal(store.has(id), false);
  assert.match(await fails(deleteAnalysis, store, { analysis_id: id }), /not found\. Use list_analyses/);
});
