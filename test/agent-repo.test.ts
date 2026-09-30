import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { agentRepo } from "../src/core/agent-repo.js";
import { computeSnapshot, type ComputedSnapshot, type SnapshotRequest } from "../src/core/git.js";
import { McpClient, baseEnv, fakeRelay, git, makeGitRepo, makeTempDir } from "./helpers.js";

/** Snapshot sans sa date de calcul, pour comparer deux calculs du même dépôt. */
function comparable(snapshot: ComputedSnapshot) {
  const { snapshotAt, ...rest } = snapshot;
  return rest;
}

async function bothWays(request: SnapshotRequest) {
  const relay = fakeRelay(process.cwd());
  const remote = await computeSnapshot(request, agentRepo(request.repoPath, relay.run));
  const local = await computeSnapshot(request);
  return { remote, local, rounds: relay.rounds() };
}

test("branch mode through the agent relay gives the same snapshot as local git", async (t) => {
  const repo = makeGitRepo();
  t.after(repo.cleanup);

  const { remote, local, rounds } = await bothWays({ repoPath: repo.dir, mode: "branch", base: "master" });
  assert.deepEqual(comparable(remote), comparable(local));
  assert.equal(remote.files.length, 7);
  assert.ok(rounds <= 6, `${rounds} rounds`);
});

test("working_tree mode through the agent relay reads the working copy and untracked files like local git", async (t) => {
  const repo = makeGitRepo();
  t.after(repo.cleanup);

  fs.writeFileSync(path.join(repo.dir, "src/app.ts"), "changed\r\n");
  fs.writeFileSync(path.join(repo.dir, "staged.txt"), "staged\n");
  git(repo.dir, "add", "staged.txt");
  fs.mkdirSync(path.join(repo.dir, "fresh dir"));
  fs.writeFileSync(path.join(repo.dir, "fresh dir/untracked file.txt"), "u1\r\nu2\r\n");
  fs.writeFileSync(path.join(repo.dir, "blob.dat"), Buffer.from([1, 0, 2]));
  fs.writeFileSync(path.join(repo.dir, "[ab].txt"), "glob-like name\n");
  fs.writeFileSync(path.join(repo.dir, "a.txt"), "matched by the glob\n");
  git(repo.dir, "add", "[ab].txt", "a.txt");

  const { remote, local } = await bothWays({ repoPath: repo.dir, mode: "working_tree" });
  assert.deepEqual(comparable(remote), comparable(local));
  assert.deepEqual(
    remote.files.filter((file) => file.path.endsWith(".txt")).map((file) => file.path),
    ["[ab].txt", "a.txt", "fresh dir/untracked file.txt", "staged.txt"]
  );
});

test("a changed file larger than the relay output limit is kept without content, as locally", async (t) => {
  const repo = makeGitRepo();
  t.after(repo.cleanup);

  const big = Array.from({ length: 40000 }, (_, i) => `line ${i} ${"x".repeat(30)}`);
  git(repo.dir, "checkout", "-q", "master");
  fs.writeFileSync(path.join(repo.dir, "big.txt"), big.join("\n") + "\n");
  git(repo.dir, "add", "big.txt");
  git(repo.dir, "commit", "-q", "-m", "big");
  git(repo.dir, "checkout", "-q", "-b", "big-change");
  big[10] = "changed";
  fs.writeFileSync(path.join(repo.dir, "big.txt"), big.join("\n") + "\n");
  git(repo.dir, "commit", "-q", "-am", "change big");

  const { remote, local } = await bothWays({ repoPath: repo.dir, mode: "branch", base: "master" });
  assert.deepEqual(comparable(remote), comparable(local));
  const entry = remote.files.find((file) => file.path === "big.txt");
  assert.deepEqual([entry?.contentAvailable, entry?.additions], [false, 1]);
});

test("a single-file diff larger than the relay output limit fails with an explicit error", async (t) => {
  const repo = makeGitRepo();
  t.after(repo.cleanup);

  fs.writeFileSync(path.join(repo.dir, "huge.txt"), `${"y".repeat(100)}\n`.repeat(12000));
  git(repo.dir, "add", "huge.txt");

  const relay = fakeRelay(process.cwd());
  await assert.rejects(
    computeSnapshot({ repoPath: repo.dir, mode: "working_tree" }, agentRepo(repo.dir, relay.run)),
    /The diff of "huge.txt" exceeds 1 MiB/
  );
});

test("the agent relay path rejects a relative path, a missing directory, a subdirectory and an unknown ref", async (t) => {
  const repo = makeGitRepo();
  const plain = makeTempDir("mcp-feature-analyzer-plain-");
  t.after(() => {
    repo.cleanup();
    plain.cleanup();
  });
  const snapshot = (request: SnapshotRequest) =>
    computeSnapshot(request, agentRepo(request.repoPath, fakeRelay(process.cwd()).run));

  await assert.rejects(snapshot({ repoPath: "relative/repo", mode: "working_tree" }), /must be an absolute path/);
  await assert.rejects(
    snapshot({ repoPath: path.join(plain.dir, "missing"), mode: "working_tree" }),
    /Could not run git in .* on the agent's machine/
  );
  await assert.rejects(snapshot({ repoPath: plain.dir, mode: "working_tree" }), /is not inside a git repository/);
  await assert.rejects(
    snapshot({ repoPath: path.join(repo.dir, "src"), mode: "working_tree" }),
    /is not the root of its git repository/
  );
  await assert.rejects(snapshot({ repoPath: repo.dir, mode: "branch", base: "nope" }), /Unknown base ref "nope"/);
});

test("in remote role, create_analysis runs git through the agent relay and other tools ignore the relay argument", async (t) => {
  const repo = makeGitRepo();
  const data = makeTempDir("mcp-feature-analyzer-remote-");
  const client = new McpClient({
    ...baseEnv(),
    MCP_FEATURE_ANALYZER_DATA_DIR: data.dir,
    MCP_FEATURE_ANALYZER_ROLE: "remote",
    MCP_SERVER_ROUTE: "/feature-analyzer",
  });
  t.after(async () => {
    await client.stop();
    repo.cleanup();
    data.cleanup();
  });
  await client.initialize("mcp-feature-analyzer-remote");

  const args = { repo_path: repo.dir, project: "Demo", title: "Remote", mode: "branch", base: "master" };
  const refused = await client.callTool("create_analysis", args);
  assert.equal(refused.isError, true);
  assert.match(refused.text, /GATEWAY_EXEC_ROUTES/);
  assert.match(refused.text, /\/feature-analyzer/);

  const announcement = { version: 1, cwd: process.cwd(), gatewayToken: false };
  const relay = fakeRelay(process.cwd());
  let result = await client.request("tools/call", { name: "create_analysis", arguments: { ...args, _gateway_exec: announcement } });
  while (result._meta?.["gateway/exec"]) {
    const request = result._meta["gateway/exec"];
    const results = await relay.run(request.steps);
    result = await client.request("tools/call", {
      name: "create_analysis",
      arguments: { _gateway_exec: { ...announcement, continuation: { id: request.id, results } } },
    });
  }
  const text = result.content.map((entry: { text: string }) => entry.text).join("\n");
  assert.notEqual(result.isError, true, text);
  assert.match(text, /Created analysis "Remote"/);
  assert.match(text, /Changed files \(7/);

  const listed = await client.callTool("list_analyses", { _gateway_exec: announcement });
  assert.equal(listed.isError, false, listed.text);
  assert.match(listed.text, /Remote/);
});
