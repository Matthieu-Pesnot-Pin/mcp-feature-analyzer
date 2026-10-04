import assert from "node:assert/strict";
import test from "node:test";

import type { FileDiff } from "../shared/schemas/diff.schema.js";
import { wholeFileDiff } from "../shared/whole-file-diff.js";

// Ancien fichier : a b c d e f g h i j ; nouveau : a b C d e f g i j k.
const DIFF: FileDiff = {
  path: "src/sample.ts",
  newContent: "a\nb\nC\nd\ne\nf\ng\ni\nj\nk\n",
  hunks: [
    {
      header: "@@ -2,3 +2,3 @@",
      oldStart: 2,
      oldLines: 3,
      newStart: 2,
      newLines: 3,
      lines: [
        { type: "context", oldNo: 2, newNo: 2, text: "b" },
        { type: "del", oldNo: 3, newNo: null, text: "c" },
        { type: "add", oldNo: null, newNo: 3, text: "C" },
        { type: "context", oldNo: 4, newNo: 4, text: "d" },
      ],
    },
    {
      header: "@@ -8 +7,0 @@",
      oldStart: 8,
      oldLines: 1,
      newStart: 7,
      newLines: 0,
      lines: [{ type: "del", oldNo: 8, newNo: null, text: "h" }],
    },
    {
      header: "@@ -10,0 +10 @@",
      oldStart: 10,
      oldLines: 0,
      newStart: 10,
      newLines: 1,
      lines: [{ type: "add", oldNo: null, newNo: 10, text: "k" }],
    },
  ],
};

test("wholeFileDiff places the unchanged lines around and between the hunks", () => {
  const whole = wholeFileDiff(DIFF);
  assert.ok(whole);
  assert.equal(whole.hunks.length, 1);
  const [hunk] = whole.hunks;
  assert.deepEqual(
    hunk.lines.map((line) => [line.type, line.oldNo, line.newNo, line.text]),
    [
      ["context", 1, 1, "a"],
      ["context", 2, 2, "b"],
      ["del", 3, null, "c"],
      ["add", null, 3, "C"],
      ["context", 4, 4, "d"],
      ["context", 5, 5, "e"],
      ["context", 6, 6, "f"],
      ["context", 7, 7, "g"],
      ["del", 8, null, "h"],
      ["context", 9, 8, "i"],
      ["context", 10, 9, "j"],
      ["add", null, 10, "k"],
    ],
  );
  assert.deepEqual(
    [hunk.header, hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines],
    ["@@ -1,10 +1,10 @@", 1, 10, 1, 10],
  );
  assert.equal(whole.newContent, DIFF.newContent);
});

test("wholeFileDiff covers a file without hunks with context lines only", () => {
  const whole = wholeFileDiff({ path: "a.txt", newContent: "x\ny", hunks: [] });
  assert.deepEqual(whole?.hunks[0].lines, [
    { type: "context", oldNo: 1, newNo: 1, text: "x" },
    { type: "context", oldNo: 2, newNo: 2, text: "y" },
  ]);
});

test("wholeFileDiff returns null when the snapshot keeps no content", () => {
  assert.equal(wholeFileDiff({ path: "a.bin", newContent: null, hunks: [] }), null);
});
