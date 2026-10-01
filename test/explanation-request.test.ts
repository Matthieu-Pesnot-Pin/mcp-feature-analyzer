import assert from "node:assert/strict";
import test from "node:test";

import { buildExplanationRequestPrompt } from "../shared/explanation-request.js";
import type { Hunk } from "../shared/schemas/diff.schema.js";
import { sampleAnalysis } from "./helpers.js";

const HUNK: Hunk = {
  header: "@@ -8,3 +8,4 @@ function parse()",
  oldStart: 8,
  oldLines: 3,
  newStart: 8,
  newLines: 4,
  lines: [
    { type: "context", oldNo: 8, newNo: 8, text: "  const a = 1;" },
    { type: "del", oldNo: 9, newNo: null, text: "  return a;" },
    { type: "add", oldNo: null, newNo: 9, text: "  const b = a + 1;" },
    { type: "add", oldNo: null, newNo: 10, text: "  return b;" },
    { type: "context", oldNo: 10, newNo: 11, text: "}" },
  ],
};

test("the explanation request locates the section and tells the agent to record explanations", () => {
  const analysis = sampleAnalysis();
  const file = { ...analysis.files[1], oldPath: "src/old.ts", status: "renamed" as const };
  const prompt = buildExplanationRequestPrompt(analysis, file, HUNK);

  assert.match(prompt, /feature analysis "OAuth refresh" \(analysis_id: "sample-abc123", project "repo"\)/);
  assert.match(prompt, /Repository: \/repo — branch master\.\.\.HEAD\./);
  assert.match(prompt, /- File: src\/a\.ts \(renamed from src\/old\.ts\)/);
  assert.match(prompt, /- New side \(code after the feature\): lines 8-11/);
  assert.match(prompt, /- Old side \(code before the feature\): lines 8-10/);
  assert.ok(
    prompt.includes(
      [
        "```",
        "@@ -8,3 +8,4 @@ function parse()",
        " 8 |  8     const a = 1;",
        " 9 |    -   return a;",
        "   |  9 +   const b = a + 1;",
        "   | 10 +   return b;",
        "10 | 11   }",
        "```",
      ].join("\n")
    ),
    prompt
  );
  assert.match(prompt, /add_explanations \(analysis_id "sample-abc123", path "src\/a\.ts"\)/);
  assert.match(prompt, /"side": "old" with old-side line numbers for removed code/);
  assert.match(prompt, /update_explanation instead of adding a duplicate/);
});

test("the explanation request says when a side of the section has no line", () => {
  const analysis = sampleAnalysis();
  const added: Hunk = { ...HUNK, oldStart: 0, oldLines: 0, lines: HUNK.lines.filter((line) => line.type === "add") };
  assert.match(buildExplanationRequestPrompt(analysis, analysis.files[1], added), /- Old side: no line \(the section only adds code\)\./);
  const removed: Hunk = { ...HUNK, newStart: 0, newLines: 0, lines: HUNK.lines.filter((line) => line.type === "del") };
  assert.match(buildExplanationRequestPrompt(analysis, analysis.files[1], removed), /- New side: no line \(the section only removes code\)\./);
});
