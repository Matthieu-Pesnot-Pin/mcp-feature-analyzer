import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { SERVER_ENTRY, baseEnv, makeTempDir } from "./helpers.js";

/**
 * `--claude-setup-mcp` exécuté comme l'utilisateur le lance : le point
 * d'entrée compilé, dans un répertoire de projet temporaire.
 */

function runSetup(cwd: string, ...flags: string[]) {
  const result = spawnSync(process.execPath, [SERVER_ENTRY, "--claude-setup-mcp", ...flags], {
    cwd,
    env: baseEnv(),
    encoding: "utf-8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function readConfig(cwd: string): any {
  return JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf-8"));
}

function withProject(name: string, body: (cwd: string) => void) {
  const temp = makeTempDir("mcp-feature-analyzer-setup-");
  const cwd = path.join(temp.dir, name);
  fs.mkdirSync(cwd);
  try {
    body(cwd);
  } finally {
    temp.cleanup();
  }
}

test("creates .mcp.json with the server entry and the generated env", () => {
  withProject("mon_projet-web", (cwd) => {
    const result = runSetup(cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Configuration mcp-feature-analyzer créée dans/);
    assert.match(result.stdout, /MCP_FEATURE_ANALYZER_DATA_DIR/);

    const entry = readConfig(cwd).mcpServers["mcp-feature-analyzer"];
    assert.equal(entry.command, "npx");
    assert.deepEqual(entry.args, ["-y", "@imenam/mcp-feature-analyzer"]);
    assert.deepEqual(entry.env, {
      PROXY_URL: "http://localhost:",
      APP_PORT: "",
      APP_GROUP: "Mon_projet-web",
      APP_NAME: "Feature Analyzer Mon Projet Web",
      APP_PATH: "/feature-analyzer-mon_projet-web",
      MCP_FEATURE_ANALYZER_DATA_DIR: path.join(cwd, ".feature-analyzer-data").replace(/\\/g, "/"),
      MCP_LOG_DIR: "",
    });
  });
});

test("merges into an existing .mcp.json and keeps the other servers", () => {
  withProject("app", (cwd) => {
    fs.writeFileSync(
      path.join(cwd, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "node", args: ["x.js"] } }, extra: true })
    );

    const result = runSetup(cwd, "--proxy_url=http://localhost:3000/");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Configuration mcp-feature-analyzer ajoutée dans/);

    const config = readConfig(cwd);
    assert.deepEqual(config.mcpServers.other, { command: "node", args: ["x.js"] });
    assert.equal(config.extra, true);
    assert.equal(config.mcpServers["mcp-feature-analyzer"].env.PROXY_URL, "http://localhost:3000");
    assert.equal(config.mcpServers["mcp-feature-analyzer"].env.APP_PORT, "");
  });
});

test("refuses to overwrite an existing entry without --force, replaces it with --force", () => {
  withProject("app", (cwd) => {
    assert.equal(runSetup(cwd).status, 0);

    const refused = runSetup(cwd, "--app_port=4321");
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /déjà configuré/);
    assert.match(refused.stderr, /--force/);
    assert.equal(readConfig(cwd).mcpServers["mcp-feature-analyzer"].env.APP_PORT, "");

    const forced = runSetup(cwd, "--force", "--app_port=4321");
    assert.equal(forced.status, 0, forced.stderr);
    assert.match(forced.stdout, /remplacée/);
    const env = readConfig(cwd).mcpServers["mcp-feature-analyzer"].env;
    assert.equal(env.APP_PORT, "4321");
    assert.equal(env.PROXY_URL, "");
  });
});

test("rejects --proxy_url and --app_port together", () => {
  withProject("app", (cwd) => {
    const result = runSetup(cwd, "--proxy_url=http://localhost:3000", "--app_port=4321");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /exclusifs/);
    assert.equal(fs.existsSync(path.join(cwd, ".mcp.json")), false);
  });
});

test("rejects an invalid port or URL", () => {
  withProject("app", (cwd) => {
    const badPort = runSetup(cwd, "--app_port=70000");
    assert.equal(badPort.status, 1);
    assert.match(badPort.stderr, /--app_port invalide/);

    const badUrl = runSetup(cwd, "--proxy_url=localhost");
    assert.equal(badUrl.status, 1);
    assert.match(badUrl.stderr, /--proxy_url invalide/);

    assert.equal(fs.existsSync(path.join(cwd, ".mcp.json")), false);
  });
});

test("refuses a .mcp.json that is not valid JSON", () => {
  withProject("app", (cwd) => {
    fs.writeFileSync(path.join(cwd, ".mcp.json"), "{ not json");
    const result = runSetup(cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /JSON invalide/);
    assert.equal(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf-8"), "{ not json");
  });
});
