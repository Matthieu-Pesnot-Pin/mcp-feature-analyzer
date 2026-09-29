import assert from "node:assert/strict";
import test from "node:test";

import { parseUnifiedDiff } from "../src/core/diff-parser.js";
import { GitError } from "../src/core/errors.js";

test("parses several hunks with old and new line numbers", () => {
  const diff = [
    "diff --git a/src/app.ts b/src/app.ts",
    "index 1111111..2222222 100644",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,3 +1,3 @@ header context",
    " line 1",
    "-line 2",
    "+line 2 changed",
    " line 3",
    "@@ -24,2 +24,3 @@",
    " line 24",
    "+inserted",
    " line 25",
    "",
  ].join("\n");

  const [file] = parseUnifiedDiff(diff);
  assert.equal(file.path, "src/app.ts");
  assert.equal(file.status, "modified");
  assert.equal(file.oldPath, null);
  assert.equal(file.binary, false);
  assert.equal(file.additions, 2);
  assert.equal(file.deletions, 1);
  assert.equal(file.hunks.length, 2);
  assert.equal(file.hunks[0].header, "@@ -1,3 +1,3 @@ header context");
  assert.deepEqual(file.hunks[0].lines, [
    { type: "context", oldNo: 1, newNo: 1, text: "line 1" },
    { type: "del", oldNo: 2, newNo: null, text: "line 2" },
    { type: "add", oldNo: null, newNo: 2, text: "line 2 changed" },
    { type: "context", oldNo: 3, newNo: 3, text: "line 3" },
  ]);
  assert.deepEqual(file.hunks[1].lines.map((line) => [line.oldNo, line.newNo]), [
    [24, 24],
    [null, 25],
    [25, 26],
  ]);
});

test("skips the no-newline marker without shifting line numbers", () => {
  const diff = [
    "diff --git a/nonl.txt b/nonl.txt",
    "--- a/nonl.txt",
    "+++ b/nonl.txt",
    "@@ -1,2 +1,3 @@",
    " first",
    "-last",
    String.raw`\ No newline at end of file`,
    "+last",
    "+after",
    String.raw`\ No newline at end of file`,
    "diff --git a/next.txt b/next.txt",
    "--- a/next.txt",
    "+++ b/next.txt",
    "@@ -1 +1 @@",
    "-a",
    "+b",
  ].join("\n");

  const files = parseUnifiedDiff(diff);
  assert.equal(files.length, 2);
  assert.deepEqual(files[0].hunks[0].lines.map((line) => `${line.type}:${line.text}`), [
    "context:first",
    "del:last",
    "add:last",
    "add:after",
  ]);
  assert.equal(files[1].path, "next.txt");
  assert.equal(files[1].hunks[0].oldLines, 1);
});

test("reads renames, including paths with spaces and quoted paths", () => {
  const diff = [
    "diff --git a/docs/old name.md b/docs/new name.md",
    "similarity index 90%",
    "rename from docs/old name.md",
    "rename to docs/new name.md",
    "--- a/docs/old name.md\t",
    "+++ b/docs/new name.md\t",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    String.raw`diff --git "a/tab\there.txt" "b/caf\303\251.txt"`,
    "similarity index 100%",
    String.raw`rename from "tab\there.txt"`,
    String.raw`rename to "caf\303\251.txt"`,
  ].join("\n");

  const [renamed, pure] = parseUnifiedDiff(diff);
  assert.equal(renamed.status, "renamed");
  assert.equal(renamed.path, "docs/new name.md");
  assert.equal(renamed.oldPath, "docs/old name.md");
  assert.equal(pure.status, "renamed");
  assert.equal(pure.path, "café.txt");
  assert.equal(pure.oldPath, "tab\there.txt");
  assert.deepEqual(pure.hunks, []);
});

test("marks binary files, added and deleted files", () => {
  const diff = [
    "diff --git a/logo.bin b/logo.bin",
    "index 1111111..2222222 100644",
    "Binary files a/logo.bin and b/logo.bin differ",
    "diff --git a/new file.ts b/new file.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/new file.ts\t",
    "@@ -0,0 +1,2 @@",
    "+a",
    "+b",
    "diff --git a/remove.txt b/remove.txt",
    "deleted file mode 100644",
    "--- a/remove.txt",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-gone",
    "diff --git a/empty.txt b/empty.txt",
    "new file mode 100644",
    "index 0000000..e69de29",
  ].join("\n");

  const [binary, added, deleted, empty] = parseUnifiedDiff(diff);
  assert.deepEqual([binary.path, binary.status, binary.binary, binary.hunks.length], ["logo.bin", "modified", true, 0]);
  assert.deepEqual([added.path, added.status, added.additions], ["new file.ts", "added", 2]);
  assert.deepEqual([deleted.path, deleted.status, deleted.deletions], ["remove.txt", "deleted", 1]);
  assert.deepEqual([empty.path, empty.status, empty.hunks.length], ["empty.txt", "added", 0]);
});

test("strips carriage returns of CRLF content lines", () => {
  const diff = [
    "diff --git a/crlf.txt b/crlf.txt",
    "--- a/crlf.txt",
    "+++ b/crlf.txt",
    "@@ -1,3 +1,3 @@",
    " alpha\r",
    "-beta\r",
    "+BETA\r",
    " gamma\r",
    "",
  ].join("\n");

  const [file] = parseUnifiedDiff(diff);
  assert.deepEqual(file.hunks[0].lines.map((line) => line.text), ["alpha", "beta", "BETA", "gamma"]);
});

test("rejects a truncated hunk with an explicit error", () => {
  const diff = ["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1,3 +1,3 @@", " a"].join("\n");
  assert.throws(() => parseUnifiedDiff(diff), (err: unknown) => err instanceof GitError && /Truncated hunk/.test((err as Error).message));
});

test("returns no file for an empty diff", () => {
  assert.deepEqual(parseUnifiedDiff(""), []);
});
