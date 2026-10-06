import assert from "node:assert/strict";
import test from "node:test";

import { expandContext, stepContext } from "../shared/context-expansion.js";
import type { FileDiff } from "../shared/schemas/diff.schema.js";

// Nouveau fichier : l1 … l30, la ligne 10 remplacée par NEW10, ADDED insérée en ligne 20.
const lines = Array.from({ length: 30 }, (_, index) => `l${index + 1}`);
lines[9] = "NEW10";
lines[19] = "ADDED";

const DIFF: FileDiff = {
  path: "src/sample.ts",
  newContent: `${lines.join("\n")}\n`,
  hunks: [
    {
      header: "@@ -7,7 +7,7 @@ fn a",
      oldStart: 7,
      oldLines: 7,
      newStart: 7,
      newLines: 7,
      lines: [
        { type: "context", oldNo: 7, newNo: 7, text: "l7" },
        { type: "context", oldNo: 8, newNo: 8, text: "l8" },
        { type: "context", oldNo: 9, newNo: 9, text: "l9" },
        { type: "del", oldNo: 10, newNo: null, text: "OLD10" },
        { type: "add", oldNo: null, newNo: 10, text: "NEW10" },
        { type: "context", oldNo: 11, newNo: 11, text: "l11" },
        { type: "context", oldNo: 12, newNo: 12, text: "l12" },
        { type: "context", oldNo: 13, newNo: 13, text: "l13" },
      ],
    },
    {
      header: "@@ -17,6 +17,7 @@",
      oldStart: 17,
      oldLines: 6,
      newStart: 17,
      newLines: 7,
      lines: [
        { type: "context", oldNo: 17, newNo: 17, text: "l17" },
        { type: "context", oldNo: 18, newNo: 18, text: "l18" },
        { type: "context", oldNo: 19, newNo: 19, text: "l19" },
        { type: "add", oldNo: null, newNo: 20, text: "ADDED" },
        { type: "context", oldNo: 20, newNo: 21, text: "l21" },
        { type: "context", oldNo: 21, newNo: 22, text: "l22" },
        { type: "context", oldNo: 22, newNo: 23, text: "l23" },
      ],
    },
  ],
};

test("expandContext: sans élargissement, les blocs restent les mêmes", () => {
  const expanded = expandContext(DIFF, []);
  assert.ok(expanded);
  assert.equal(expanded.fileDiff.hunks[0], DIFF.hunks[0]);
  assert.equal(expanded.fileDiff.hunks[1], DIFF.hunks[1]);
  assert.equal(expanded.added.size, 0);
  assert.deepEqual(
    expanded.hunks.map((hunk) => hunk.context),
    [3, 3],
  );
});

test("expandContext: ajoute des lignes au-dessus et en dessous, bornées par le bloc suivant", () => {
  const expanded = expandContext(DIFF, [2, 0]);
  assert.ok(expanded);
  const hunk = expanded.fileDiff.hunks[0];
  assert.equal(hunk.header, "@@ -5,11 +5,11 @@ fn a");
  assert.deepEqual(
    hunk.lines.slice(0, 2).map((line) => [line.oldNo, line.newNo, line.text]),
    [
      [5, 5, "l5"],
      [6, 6, "l6"],
    ],
  );
  assert.deepEqual(
    hunk.lines.slice(-2).map((line) => line.newNo),
    [14, 15],
  );
  assert.deepEqual(expanded.hunks[0], { context: 5, members: [0], canShrink: true, canGrow: true });
  assert.equal(expanded.fileDiff.hunks[1], DIFF.hunks[1]);
  assert.deepEqual([...expanded.added].sort((a, b) => a - b), [5, 6, 14, 15]);
});

test("expandContext: deux blocs que plus rien ne sépare n'en forment plus qu'un", () => {
  const expanded = expandContext(DIFF, [5, 0]);
  assert.ok(expanded);
  assert.equal(expanded.fileDiff.hunks.length, 1);
  const hunk = expanded.fileDiff.hunks[0];
  assert.equal(hunk.header, "@@ -2,21 +2,22 @@ fn a");
  assert.deepEqual(
    hunk.lines.map((line) => line.newNo ?? 0),
    [2, 3, 4, 5, 6, 7, 8, 9, 0, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
  );
  assert.deepEqual(expanded.hunks, [{ context: 8, members: [0, 1], canShrink: true, canGrow: true }]);
  assert.deepEqual(expanded.extras, [5, 0]);
});

test("expandContext: les lignes d'un bloc décalé gardent leur numéro du côté ancien", () => {
  const expanded = expandContext(DIFF, [0, 2]);
  assert.ok(expanded);
  const hunk = expanded.fileDiff.hunks[1];
  assert.equal(hunk.header, "@@ -15,10 +15,11 @@");
  assert.deepEqual(
    hunk.lines.slice(0, 2).map((line) => [line.oldNo, line.newNo]),
    [
      [15, 15],
      [16, 16],
    ],
  );
  assert.deepEqual(hunk.lines.at(-1), { type: "context", oldNo: 24, newNo: 25, text: "l25" });
});

test("expandContext: le début et la fin du fichier bornent l'élargissement", () => {
  const expanded = expandContext(DIFF, [100, 100]);
  assert.ok(expanded);
  const [hunk] = expanded.fileDiff.hunks;
  assert.equal(hunk.lines[0].newNo, 1);
  assert.deepEqual(hunk.lines.at(-1), { type: "context", oldNo: 29, newNo: 30, text: "l30" });
  assert.deepEqual(expanded.hunks, [{ context: 9, members: [0, 1], canShrink: true, canGrow: false }]);
});

test("stepContext: un clic sur un bloc réuni élargit ou réduit chacun de ses blocs", () => {
  const expanded = expandContext(DIFF, [5, 0]);
  assert.ok(expanded);
  assert.deepEqual(stepContext(expanded, 0, 1), [10, 5]);
  assert.deepEqual(stepContext(expanded, 0, -1), [0, 0]);
});

test("expandContext: null quand le contenu du fichier n'est pas conservé", () => {
  assert.equal(expandContext({ ...DIFF, newContent: null }, [5, 5]), null);
});
