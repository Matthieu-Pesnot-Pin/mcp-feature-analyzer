import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import fs from "node:fs";
import path from "node:path";

import { McpClient, baseEnv, makeGitRepo, makeTempDir } from "./helpers.js";

/**
 * Démarrage du serveur MCP compilé, GUI désactivée (ni PROXY_URL ni APP_PORT),
 * sur un répertoire de données et de logs temporaire.
 */

let client: McpClient;
let temp: { dir: string; cleanup: () => void };

before(async () => {
  temp = makeTempDir("mcp-feature-analyzer-server-");
  client = new McpClient({ ...baseEnv(), MCP_FEATURE_ANALYZER_DATA_DIR: temp.dir });
  await client.initialize("mcp-feature-analyzer-smoke");
});

after(async () => {
  await client?.stop();
  temp?.cleanup();
});

test("the server answers tools/list and exposes reconnect_gui", async () => {
  const result = await client.request("tools/list");
  const names = result.tools.map((tool: { name: string }) => tool.name);
  assert.ok(names.includes("reconnect_gui"), `reconnect_gui missing from ${JSON.stringify(names)}`);
});

const EXPECTED_TOOLS = [
  "add_findings",
  "create_analysis",
  "delete_analysis",
  "delete_diagram",
  "delete_findings",
  "get_analysis",
  "get_diff",
  "get_review_feedback",
  "list_analyses",
  "reconnect_gui",
  "refresh_analysis",
  "set_diagram",
  "update_analysis",
  "update_finding",
];

test("tools/list exposes exactly the 14 tools, each with a description and an object input schema", async () => {
  const result = await client.request("tools/list");
  const names = result.tools.map((tool: { name: string }) => tool.name).sort();
  assert.deepEqual(names, EXPECTED_TOOLS);
  for (const tool of result.tools) {
    assert.ok(typeof tool.description === "string" && tool.description.trim() !== "", `${tool.name} has no description`);
    assert.equal(tool.inputSchema?.type, "object", `${tool.name} has no object inputSchema`);
  }
});

test("the server publishes instructions describing the review workflow", async () => {
  const probe = new McpClient({ ...baseEnv(), MCP_FEATURE_ANALYZER_DATA_DIR: temp.dir });
  try {
    const result = await probe.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "probe", version: "1.0.0" },
    });
    assert.match(result.instructions, /create_analysis[\s\S]*get_diff[\s\S]*add_findings[\s\S]*get_review_feedback[\s\S]*refresh_analysis/);
    assert.match(result.instructions, /NEW-side/);
    assert.match(result.instructions, /3\. update_analysis with the overview \(objective, approach, attention_points\) and the summary/);
    assert.match(result.instructions, /5 to 12 nodes[\s\S]*Zero crossings are expected/);
  } finally {
    await probe.stop();
  }
});

test("create_analysis, add_findings and get_analysis round-trip through the stdio server", async (t) => {
  const repo = makeGitRepo();
  t.after(repo.cleanup);

  const created = await client.callTool("create_analysis", { repo_path: repo.dir, project: "demo", title: "Round trip", mode: "branch", base: "master" });
  assert.equal(created.isError, false, created.text);
  assert.doesNotMatch(created.text, /Open the review:/, "no GUI link when the GUI is disabled");
  const id = /\(id: ([a-z0-9-]+)\)/.exec(created.text)![1];

  const added = await client.callTool("add_findings", {
    analysis_id: id,
    findings: [{ id: "f1", severity: "major", title: "Changed line", body: "Check it", path: "src/app.ts", start_line: 2 }],
  });
  assert.equal(added.isError, false, added.text);
  assert.match(added.text, /f1 \[major\] issue, open — src\/app\.ts:2 — Changed line/);

  const view = await client.callTool("get_analysis", { analysis_id: id });
  assert.equal(view.isError, false, view.text);
  assert.match(view.text, /# Round trip/);
  assert.match(view.text, /f1 \[major\] issue, open — src\/app\.ts:2 — Changed line/);

  const bad = await client.callTool("add_findings", { analysis_id: id, findings: [{ severity: "major", title: "X", body: "Y", path: "src/app.ts", start_line: 99 }] });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /^Error: No finding was added/);
});

test("the server identifies itself with its package name", async () => {
  const probe = new McpClient({ ...baseEnv(), MCP_FEATURE_ANALYZER_DATA_DIR: temp.dir });
  try {
    const result = await probe.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "probe", version: "1.0.0" },
    });
    assert.equal(result.serverInfo.name, "mcp-feature-analyzer");
    assert.match(result.serverInfo.version, /^\d+\.\d+\.\d+/);
  } finally {
    await probe.stop();
  }
});

test("reconnect_gui reports that the GUI is disabled when neither PROXY_URL nor APP_PORT is set", async () => {
  const result = await client.callTool("reconnect_gui");
  assert.equal(result.isError, true);
  assert.match(result.text, /PROXY_URL is not set/);
});

test("an unknown tool returns an explicit error", async () => {
  const result = await client.callTool("does_not_exist");
  assert.equal(result.isError, true);
  assert.equal(result.text, "Error: Tool not found: does_not_exist");
});

test("logs go to <dataDir>/logs and nothing but JSON-RPC reaches stdout", () => {
  assert.ok(fs.existsSync(path.join(temp.dir, "logs", "server.log")), "server.log must be written under <dataDir>/logs");
  assert.deepEqual(client.strayStdout, []);
});
