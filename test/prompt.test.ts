import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentPrompt, buildAllOpenFindingsPrompt } from "../shared/prompt.js";
import type { Analysis } from "../shared/schemas/analysis.schema.js";
import { sampleAnalysis, sampleFinding } from "./helpers.js";

function fixture(): Analysis {
  return sampleAnalysis({
    title: "OAuth refresh",
    base: "master",
    head: "feat/oauth-refresh",
    findings: [
      sampleFinding({
        id: "f_minor",
        severity: "minor",
        title: "Hard-coded delay",
        location: { path: "src/a.ts", startLine: 5, endLine: 5 },
        anchorText: "five",
      }),
      sampleFinding({
        id: "f_crit",
        severity: "critical",
        title: "Swallowed refresh error",
        body: "The catch returns null without logging.\nThrow a RefreshError instead.",
        location: { path: "src/a.ts", startLine: 2, endLine: 3 },
        anchorText: "two\nthree",
        suggestion: "two\nthrow new RefreshError();",
      }),
      sampleFinding({
        id: "f_gap",
        severity: "major",
        kind: "requirement_gap",
        title: "Logout after 3 failures",
        body: "Required by TM-142.",
        location: null,
        anchorText: null,
      }),
      sampleFinding({
        id: "f_custom",
        severity: "major",
        title: "Deleted tests",
        location: { path: "src/a.ts", startLine: 1, endLine: 1 },
        anchorText: "one",
        prompt: "Restore the two deleted session tests.",
      }),
      sampleFinding({ id: "f_ignored", severity: "trivial", status: "ignored", title: "Ignored" }),
    ],
    notes: [
      { id: "n_line", location: { path: "src/a.ts", line: 4 }, text: "Use the shared logger.", createdAt: "2026-09-29T10:00:00.000Z" },
      { id: "n_file", location: { path: "img.png", line: null }, text: "Too large.\nCompress it.", createdAt: "2026-09-29T10:00:00.000Z" },
      { id: "n_general", location: null, text: "Nice work overall.", createdAt: "2026-09-29T10:00:00.000Z" },
    ],
  });
}

test("buildAgentPrompt renders the header, decision, findings by severity and reviewer notes", () => {
  const prompt = buildAgentPrompt(fixture(), {
    findingIds: ["f_minor", "f_crit", "f_gap", "f_custom"],
    noteIds: ["n_general", "n_line", "n_file"],
    decision: "request_changes",
  });
  const expected = [
    'Review feedback on "OAuth refresh" (branch master...feat/oauth-refresh).',
    "Decision: Request changes. Rework the feature and address the points below.",
    "",
    "Address the following points:",
    "",
    "1. [Critical] src/a.ts:2-3 — Swallowed refresh error",
    "   The catch returns null without logging.",
    "   Throw a RefreshError instead.",
    "   Current lines:",
    "   ```",
    "   two",
    "   three",
    "   ```",
    "   Proposed replacement:",
    "   ```",
    "   two",
    "   throw new RefreshError();",
    "   ```",
    "",
    "2. [Major] Missing requirement: Logout after 3 failures",
    "   Required by TM-142.",
    "",
    "3. [Major] src/a.ts:1 — Deleted tests",
    "   Restore the two deleted session tests.",
    "",
    "4. [Minor] src/a.ts:5 — Hard-coded delay",
    "   Current lines:",
    "   ```",
    "   five",
    "   ```",
    "",
    "5. [Reviewer note] src/a.ts:4 — Use the shared logger.",
    "",
    "6. [Reviewer note] img.png — Too large.",
    "   Compress it.",
    "",
    "7. [Reviewer note] Nice work overall.",
  ].join("\n");
  assert.equal(prompt, expected);
});

test("buildAgentPrompt describes a working tree analysis and an empty selection", () => {
  const analysis = sampleAnalysis({ mode: "working_tree", base: "HEAD", head: null, headCommit: null, title: "WIP" });
  assert.equal(
    buildAgentPrompt(analysis, { findingIds: [], noteIds: [], decision: "approve" }),
    ['Review feedback on "WIP" (working tree changes against HEAD).', "Decision: Approve. The feature can be merged.", "", "No points to address."].join("\n")
  );
});

test("buildAgentPrompt adds the feature objective to the header when the analysis has an overview", () => {
  const analysis = sampleAnalysis({
    mode: "working_tree",
    base: "HEAD",
    head: null,
    headCommit: null,
    title: "WIP",
    overview: { objective: "Refresh expired tokens without logging the user out.", approach: "A retry wrapper.", attentionPoints: ["Races"] },
  });
  assert.equal(
    buildAgentPrompt(analysis, { findingIds: [], noteIds: [], decision: "approve" }),
    [
      'Review feedback on "WIP" (working tree changes against HEAD).',
      "Feature objective: Refresh expired tokens without logging the user out.",
      "Decision: Approve. The feature can be merged.",
      "",
      "No points to address.",
    ].join("\n")
  );
});

test("buildAgentPrompt rejects unknown ids", () => {
  assert.throws(
    () => buildAgentPrompt(fixture(), { findingIds: ["f_nope"], noteIds: ["n_nope"], decision: null }),
    /Unknown finding id\(s\): f_nope\./
  );
});

test("buildAllOpenFindingsPrompt lists every open finding, without notes or decision", () => {
  const prompt = buildAllOpenFindingsPrompt(fixture());
  assert.ok(prompt.startsWith('Review feedback on "OAuth refresh" (branch master...feat/oauth-refresh).\n\nAddress the following points:'));
  const headers = prompt.split("\n").filter((line) => /^\d+\. /.test(line));
  assert.deepEqual(headers, [
    "1. [Critical] src/a.ts:2-3 — Swallowed refresh error",
    "2. [Major] Missing requirement: Logout after 3 failures",
    "3. [Major] src/a.ts:1 — Deleted tests",
    "4. [Minor] src/a.ts:5 — Hard-coded delay",
  ]);
});
