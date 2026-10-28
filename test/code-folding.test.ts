import assert from "node:assert/strict";
import test from "node:test";

import { foldRegions, hiddenLines, stepFold } from "../shared/code-folding.js";

const source = [
  "function a() {", // 0
  "  if (x) {", // 1
  "    for (;;) {", // 2
  "      run()", // 3
  "    }", // 4
  "  }", // 5
  "", // 6
  "  if (y) {", // 7
  "    stop()", // 8
  "  }", // 9
  "}", // 10
];

/** Résumé lisible des blocs : « début-fin@profondeur ». */
function shape(lines: Array<string | null>): string[] {
  return foldRegions(lines).map((region) => `${region.start}-${region.end}@${region.depth}`);
}

test("foldRegions: nested blocks by indentation, closing lines left out", () => {
  assert.deepEqual(shape(source), ["0-9@0", "1-4@1", "2-3@2", "7-8@1"]);
});

test("foldRegions: null and blank lines neither open nor close a block", () => {
  assert.deepEqual(shape(["if (a) {", null, "", "  b()", null, "}"]), ["0-3@0"]);
});

test("foldRegions: tabs count as indentation", () => {
  assert.deepEqual(shape(["a:", "\tb", "c"]), ["0-1@0"]);
});

test("hiddenLines: lines of the folded blocks except their first", () => {
  assert.deepEqual([...hiddenLines(foldRegions(source), new Set([1, 3]))].sort((a, b) => a - b), [2, 3, 4, 8]);
});

test("stepFold: deepest blocks first, then each level up to the block itself, then everything reopens", () => {
  const regions = foldRegions(source);
  const steps: number[][] = [];
  let folded = new Set<number>();
  for (let step = 0; step < 4; step++) {
    folded = stepFold(regions, 0, folded);
    steps.push([...folded].sort());
  }
  assert.deepEqual(steps, [[2], [1, 2, 3], [0, 1, 2, 3], []]);
});

test("stepFold: blocks hidden by a folded parent are skipped", () => {
  const regions = foldRegions(source);
  assert.deepEqual([...stepFold(regions, 0, new Set([1]))].sort(), [1, 3]);
});

test("stepFold: blocks outside the clicked one are kept", () => {
  const regions = foldRegions(source);
  assert.deepEqual([...stepFold(regions, 1, new Set([3]))].sort(), [2, 3]);
});
