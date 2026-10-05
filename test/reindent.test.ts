import assert from "node:assert/strict";
import test from "node:test";

import type { DiffLine } from "../shared/schemas/diff.schema.js";
import { indentChange, mergeReindentedLines } from "../shared/reindent.js";

const del = (oldNo: number, text: string): DiffLine => ({ type: "del", oldNo, newNo: null, text });
const add = (newNo: number, text: string): DiffLine => ({ type: "add", oldNo: null, newNo, text });
const context = (oldNo: number, newNo: number, text: string): DiffLine => ({ type: "context", oldNo, newNo, text });

/** Résumé lisible d'une ligne fusionnée : « 3>4 » pour une paire, « -3 », « +4 », « =3 » sinon. */
function shape(lines: DiffLine[]): string[] {
  return mergeReindentedLines(lines).map(({ line, oldLine }) =>
    oldLine ? `${oldLine.oldNo}>${line.newNo}` : line.type === "del" ? `-${line.oldNo}` : line.type === "add" ? `+${line.newNo}` : `=${line.newNo}`
  );
}

test("mergeReindentedLines: a reindented block becomes one line per pair", () => {
  const lines = [
    context(1, 1, "if (a) {"),
    del(2, "foo()"),
    del(3, "bar()"),
    add(2, "  foo()"),
    add(3, "  bar()"),
    context(4, 4, "}"),
  ];
  assert.deepEqual(shape(lines), ["=1", "2>2", "3>3", "=4"]);
});

test("mergeReindentedLines: unmatched lines keep the diff order between pairs", () => {
  const lines = [del(1, "a()"), del(2, "old()"), del(3, "b()"), add(1, "  a()"), add(2, "  added()"), add(3, "  b()")];
  assert.deepEqual(shape(lines), ["1>1", "-2", "+2", "3>3"]);
});

test("mergeReindentedLines: lines that differ beyond indentation stay apart", () => {
  const lines = [del(1, "foo(1)"), add(1, "  foo(2)")];
  assert.deepEqual(shape(lines), ["-1", "+1"]);
});

test("indentChange: range of the differing indentation on each side", () => {
  assert.deepEqual(indentChange("  x", "      x"), { start: 2, oldEnd: 2, newEnd: 6 });
  assert.deepEqual(indentChange("\tx", "  x"), { start: 0, oldEnd: 1, newEnd: 2 });
});
