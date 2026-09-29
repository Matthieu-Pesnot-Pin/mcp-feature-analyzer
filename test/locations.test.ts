import assert from "node:assert/strict";
import test from "node:test";

import { assertNoteLocation, resolveLocation } from "../src/core/locations.js";
import { AnalysisError } from "../src/core/errors.js";
import type { DiffSnapshot } from "../shared/schemas/diff.schema.js";
import type { FileEntry } from "../shared/schemas/analysis.schema.js";
import { sampleSnapshot } from "./helpers.js";

function fixture(): { snapshot: DiffSnapshot; files: FileEntry[] } {
  const computed = sampleSnapshot();
  const files: FileEntry[] = [
    ...computed.files,
    { path: "gone.ts", oldPath: null, status: "deleted", additions: 0, deletions: 3, binary: false, contentAvailable: false, lineCount: 0, reviewed: false },
    { path: "big.json", oldPath: null, status: "added", additions: 9, deletions: 0, binary: false, contentAvailable: false, lineCount: 0, reviewed: false },
    { path: "crlf.txt", oldPath: null, status: "modified", additions: 1, deletions: 1, binary: false, contentAvailable: true, lineCount: 3, reviewed: false },
  ];
  const snapshot: DiffSnapshot = {
    analysisId: "sample-abc123",
    files: [
      ...computed.diff,
      { path: "gone.ts", hunks: [], newContent: null },
      { path: "big.json", hunks: [], newContent: null },
      { path: "crlf.txt", hunks: [], newContent: "a\r\nb\r\nc" },
    ],
  };
  return { snapshot, files };
}

test("returns the exact text of the targeted lines, endLine defaulting to startLine", () => {
  const { snapshot, files } = fixture();
  assert.deepEqual(resolveLocation(snapshot, files, { path: "src/a.ts", startLine: 2, endLine: 4 }), {
    path: "src/a.ts",
    startLine: 2,
    endLine: 4,
    anchorText: "two\nthree\nfour",
  });
  assert.equal(resolveLocation(snapshot, files, { path: "src/a.ts", startLine: 5 }).anchorText, "five");
  assert.equal(resolveLocation(snapshot, files, { path: "crlf.txt", startLine: 2, endLine: 3 }).anchorText, "b\nc");
});

test("rejects a file outside the analysis and lists the changed files", () => {
  const { snapshot, files } = fixture();
  assert.throws(
    () => resolveLocation(snapshot, files, { path: "other.ts", startLine: 1 }),
    (err: unknown) =>
      err instanceof AnalysisError &&
      err.message ===
        'File "other.ts" is not part of this analysis (changed files: img.png, src/a.ts, gone.ts, big.json, crlf.txt).'
  );
});

test("explains why content is unavailable: binary, deleted or too large", () => {
  const { snapshot, files } = fixture();
  assert.throws(() => resolveLocation(snapshot, files, { path: "img.png", startLine: 1 }), /content is not available because it is binary/);
  assert.throws(() => resolveLocation(snapshot, files, { path: "gone.ts", startLine: 1 }), /because it is deleted/);
  assert.throws(
    () => resolveLocation(snapshot, files, { path: "big.json", startLine: 1 }),
    /because it is larger than the snapshot size limit/
  );
});

test("rejects lines out of range with the file's line count", () => {
  const { snapshot, files } = fixture();
  assert.throws(
    () => resolveLocation(snapshot, files, { path: "src/a.ts", startLine: 4, endLine: 6 }),
    /Lines 4-6 are out of range for "src\/a.ts", which has 5 line\(s\) on the new side\. Use get_diff/
  );
  assert.throws(() => resolveLocation(snapshot, files, { path: "src/a.ts", startLine: 0 }), /Invalid line range 0-0/);
  assert.throws(() => resolveLocation(snapshot, files, { path: "src/a.ts", startLine: 3, endLine: 2 }), /end_line must be >= start_line/);
});

test("note locations target a changed file and, when given, an existing new-side line", () => {
  const { files } = fixture();
  assert.doesNotThrow(() => assertNoteLocation(files, { path: "src/a.ts", line: 5 }));
  assert.doesNotThrow(() => assertNoteLocation(files, { path: "img.png", line: null }));
  assert.throws(() => assertNoteLocation(files, { path: "x.ts", line: null }), /is not part of this analysis/);
  assert.throws(() => assertNoteLocation(files, { path: "src/a.ts", line: 6 }), /Line 6 is out of range .* 5 line\(s\)/);
  assert.throws(() => assertNoteLocation(files, { path: "img.png", line: 1 }), /Attach the note to the whole file instead/);
});
