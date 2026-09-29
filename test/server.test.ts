import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import fs from "node:fs";
import path from "node:path";

import { McpClient, baseEnv, makeTempDir } from "./helpers.js";

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
