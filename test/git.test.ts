import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { computeSnapshot, type ComputedSnapshot } from "../src/core/git.js";
import { GitError } from "../src/core/errors.js";
import { APP_LINES, git, makeGitRepo, makeTempDir } from "./helpers.js";

function byPath(snapshot: ComputedSnapshot, filePath: string) {
  const entry = snapshot.files.find((file) => file.path === filePath);
  const diff = snapshot.diff.find((file) => file.path === filePath);
  assert.ok(entry && diff, `${filePath} missing from ${snapshot.files.map((f) => f.path).join(", ")}`);
  return { entry, diff };
}

test("branch mode diffs base...head and reads the new side from the head commit", async (t) => {
  const repo = makeGitRepo();
  t.after(repo.cleanup);

  const snapshot = await computeSnapshot({ repoPath: repo.dir, mode: "branch", base: "master" });
  assert.equal(snapshot.head, "HEAD");
  assert.equal(snapshot.baseCommit, git(repo.dir, "rev-parse", "master").trim());
  assert.equal(snapshot.headCommit, git(repo.dir, "rev-parse", "feature").trim());
  assert.deepEqual(
    snapshot.files.map((file) => `${file.status}:${file.path}`),
    [
      "modified:crlf.txt",
      "renamed:docs/new name.md",
      "modified:logo.bin",
      "modified:nonl.txt",
      "deleted:remove.txt",
      "modified:src/app.ts",
      "added:src/new file.ts",
    ]
  );
  assert.ok(snapshot.files.every((file) => file.reviewed === false));

  const app = byPath(snapshot, "src/app.ts");
  assert.equal(app.diff.hunks.length, 2);
  assert.equal(app.entry.additions, 2);
  assert.equal(app.entry.deletions, 1);
  assert.equal(app.entry.lineCount, 31);
  assert.equal(app.entry.contentAvailable, true);
  assert.ok(app.diff.newContent?.includes("inserted after 25"));

  const renamed = byPath(snapshot, "docs/new name.md");
  assert.equal(renamed.entry.oldPath, "docs/old name.md");

  const binary = byPath(snapshot, "logo.bin");
  assert.deepEqual([binary.entry.binary, binary.entry.contentAvailable, binary.entry.lineCount], [true, false, 0]);
  assert.deepEqual(binary.diff.hunks, []);
  assert.equal(binary.diff.newContent, null);

  const deleted = byPath(snapshot, "remove.txt");
  assert.deepEqual([deleted.entry.contentAvailable, deleted.diff.newContent], [false, null]);

  const crlf = byPath(snapshot, "crlf.txt");
  assert.equal(crlf.diff.newContent, "alpha\r\nBETA\r\ngamma\r\n");
  assert.equal(crlf.entry.lineCount, 3);
  assert.deepEqual(crlf.diff.hunks[0].lines.map((line) => line.text), ["alpha", "beta", "BETA", "gamma"]);

  const nonl = byPath(snapshot, "nonl.txt");
  assert.equal(nonl.entry.lineCount, 3);
  assert.equal(nonl.diff.newContent, "first\nlast\nafter");
});

test("branch mode accepts an explicit head and returns an empty diff for identical refs", async (t) => {
  const repo = makeGitRepo();
  t.after(repo.cleanup);

  const snapshot = await computeSnapshot({ repoPath: repo.dir, mode: "branch", base: "master", head: "master" });
  assert.equal(snapshot.head, "master");
  assert.deepEqual(snapshot.files, []);
});

test("working_tree mode includes staged, unstaged and untracked changes", async (t) => {
  const repo = makeGitRepo();
  t.after(repo.cleanup);

  fs.writeFileSync(path.join(repo.dir, "src/app.ts"), APP_LINES.join("\n") + "\nappended\n");
  fs.writeFileSync(path.join(repo.dir, "staged.txt"), "staged\n");
  git(repo.dir, "add", "staged.txt");
  fs.mkdirSync(path.join(repo.dir, "fresh dir"));
  fs.writeFileSync(path.join(repo.dir, "fresh dir/untracked file.txt"), "u1\r\nu2\r\n");
  fs.writeFileSync(path.join(repo.dir, "blob.dat"), Buffer.from([1, 0, 2]));
  fs.writeFileSync(path.join(repo.dir, ".gitignore"), "ignored.log\n");
  fs.writeFileSync(path.join(repo.dir, "ignored.log"), "noise\n");

  const snapshot = await computeSnapshot({ repoPath: repo.dir, mode: "working_tree" });
  assert.equal(snapshot.base, "HEAD");
  assert.equal(snapshot.head, null);
  assert.equal(snapshot.headCommit, null);
  assert.equal(snapshot.baseCommit, git(repo.dir, "rev-parse", "HEAD").trim());
  assert.deepEqual(
    snapshot.files.map((file) => `${file.status}:${file.path}`),
    ["added:.gitignore", "added:blob.dat", "added:fresh dir/untracked file.txt", "modified:src/app.ts", "added:staged.txt"]
  );

  const app = byPath(snapshot, "src/app.ts");
  assert.equal(app.entry.lineCount, 31);
  assert.ok(app.diff.newContent?.endsWith("appended\n"));

  const untracked = byPath(snapshot, "fresh dir/untracked file.txt");
  assert.equal(untracked.entry.additions, 2);
  assert.equal(untracked.diff.hunks[0].header, "@@ -0,0 +1,2 @@");
  assert.deepEqual(untracked.diff.hunks[0].lines.map((line) => [line.newNo, line.text]), [
    [1, "u1"],
    [2, "u2"],
  ]);

  const blob = byPath(snapshot, "blob.dat");
  assert.deepEqual([blob.entry.binary, blob.entry.contentAvailable, blob.diff.hunks.length], [true, false, 0]);
});

test("rejects a relative path, a missing path, a non-repository and a subdirectory", async (t) => {
  const repo = makeGitRepo();
  const plain = makeTempDir("mcp-feature-analyzer-plain-");
  t.after(() => {
    repo.cleanup();
    plain.cleanup();
  });

  await assert.rejects(computeSnapshot({ repoPath: "relative/repo", mode: "working_tree" }), /must be an absolute path/);
  await assert.rejects(
    computeSnapshot({ repoPath: path.join(plain.dir, "missing"), mode: "working_tree" }),
    /does not exist/
  );
  await assert.rejects(computeSnapshot({ repoPath: plain.dir, mode: "working_tree" }), /is not inside a git repository/);
  await assert.rejects(
    computeSnapshot({ repoPath: path.join(repo.dir, "src"), mode: "working_tree" }),
    /is not the root of its git repository/
  );
});

test("rejects an unknown ref, a missing base and refs that look like options", async (t) => {
  const repo = makeGitRepo();
  t.after(repo.cleanup);

  await assert.rejects(
    computeSnapshot({ repoPath: repo.dir, mode: "branch", base: "does-not-exist" }),
    (err: unknown) => err instanceof GitError && /Unknown base ref "does-not-exist"/.test((err as Error).message)
  );
  await assert.rejects(
    computeSnapshot({ repoPath: repo.dir, mode: "branch", base: "master", head: "nope" }),
    /Unknown head ref "nope"/
  );
  await assert.rejects(computeSnapshot({ repoPath: repo.dir, mode: "branch" }), /"base" is required in branch mode/);
  await assert.rejects(computeSnapshot({ repoPath: repo.dir, mode: "branch", base: "--output=x" }), /cannot start with "-"/);
  await assert.rejects(
    computeSnapshot({ repoPath: repo.dir, mode: "working_tree", head: "feature" }),
    /"head" is not accepted in working_tree mode/
  );
});
