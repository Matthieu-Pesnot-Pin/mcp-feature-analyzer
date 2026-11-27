import assert from "node:assert/strict";
import test from "node:test";

import type { DiffLine } from "../shared/schemas/diff.schema.js";
import { inlineChanges, inlineChangesOfLines, pairSimilarLines, type CharRange } from "../shared/inline-diff.js";
import { mergeReindentedLines } from "../shared/reindent.js";

const del = (oldNo: number, text: string): DiffLine => ({ type: "del", oldNo, newNo: null, text });
const add = (newNo: number, text: string): DiffLine => ({ type: "add", oldNo: null, newNo, text });
const context = (oldNo: number, newNo: number, text: string): DiffLine => ({ type: "context", oldNo, newNo, text });

/** Textes couverts par les plages, pour des assertions lisibles. */
const parts = (text: string, ranges: CharRange[]) => ranges.map((range) => text.slice(range.start, range.end));

test("inlineChanges: only the changed words of a modified line are marked", () => {
  const oldText = "const total = computeTotal(items, tax);";
  const newText = "const total = computeTotal(items, taxRate, discount);";
  const changes = inlineChanges(oldText, newText)!;
  assert.deepEqual(parts(oldText, changes.removed), ["tax"]);
  assert.deepEqual(parts(newText, changes.added), ["taxRate, discount"]);
});

test("inlineChanges: an insertion marks nothing on the removed line", () => {
  const oldText = "return value;";
  const newText = "return value ?? null;";
  const changes = inlineChanges(oldText, newText)!;
  assert.deepEqual(changes.removed, []);
  assert.deepEqual(parts(newText, changes.added), ["?? null"], "spaces at the edges of a part are not marked");
});

test("inlineChanges: a renamed identifier in a short line is compared word by word", () => {
  const changes = inlineChanges("  let total = 0", "  let subtotal = 0")!;
  assert.deepEqual(parts("  let total = 0", changes.removed), ["total"]);
  assert.deepEqual(parts("  let subtotal = 0", changes.added), ["subtotal"]);
});

test("inlineChanges: identical, too different or empty lines are not compared", () => {
  assert.equal(inlineChanges("same()", "same()"), null);
  assert.equal(inlineChanges("const a = 1;", "throw new Error('boom');"), null);
  assert.equal(inlineChanges("   ", "\t"), null);
});

test("pairSimilarLines: an inserted line does not shift the pairing of a modified line", () => {
  const removed = ["$allocation['packs'][$item->id] = $this->makeAllocationLine($product, $product->complete_reference, $product->allocable_pack_quantity, $requested);"];
  const added = [
    "$allocablePackQuantity = $quantities->pack_allocable_quantity ?? $quantities->allocable_quantity;",
    "$allocation['packs'][$item->id] = $this->makeAllocationLine($product, $product->complete_reference, $allocablePackQuantity, $requested);",
  ];
  const pairs = pairSimilarLines(removed, added);
  assert.deepEqual(
    pairs.map((pair) => [pair.removed, pair.added]),
    [[0, 1]],
  );
  assert.deepEqual(parts(removed[0], pairs[0].changes.removed), ["$product->allocable_pack_quantity"]);
  assert.deepEqual(parts(added[1], pairs[0].changes.added), ["$allocablePackQuantity"]);
});

test("pairSimilarLines: lines without a close counterpart stay unpaired, pairs keep the order of both runs", () => {
  const pairs = pairSimilarLines(["  let count = 0;", "  run(count);", "  done();"], ["  log('start');", "  let total = 0;", "  done(true, false, 1);", "  run(total);"]);
  const pairsAsIndices = pairs.map((pair) => [pair.removed, pair.added]);
  assert.deepEqual(pairsAsIndices, [
    [0, 1],
    [1, 3],
  ]);
});

test("inlineChangesOfLines: pairs similar removed and added lines, outside reindented lines", () => {
  const lines = [
    context(1, 1, "function f() {"),
    del(2, "  let count = 0;"),
    del(3, "  run(count);"),
    add(2, "  let total = 0;"),
    add(3, "  run(total);"),
    add(4, "  log('done');"),
    del(4, "if (x) {"),
    add(5, "  if (x) {"),
    context(5, 6, "}"),
  ];
  const result = inlineChangesOfLines(mergeReindentedLines(lines));
  assert.deepEqual(parts(lines[1].text, result.get(lines[1])!.ranges), ["count"]);
  assert.deepEqual(parts(lines[3].text, result.get(lines[3])!.ranges), ["total"]);
  assert.deepEqual(parts(lines[2].text, result.get(lines[2])!.ranges), ["count"]);
  assert.deepEqual(parts(lines[4].text, result.get(lines[4])!.ranges), ["total"]);
  assert.equal(result.get(lines[1])!.counterpart, lines[3]);
  assert.equal(result.get(lines[4])!.counterpart, lines[2]);
  assert.equal(result.has(lines[5]), false, "an added line without counterpart keeps its full highlight");
  assert.equal(result.has(lines[6]), false, "a reindented line is not compared word by word");
  assert.equal(result.has(lines[7]), false);
});
