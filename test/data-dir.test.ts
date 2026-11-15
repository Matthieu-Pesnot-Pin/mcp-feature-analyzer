import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { resolveDataDir } from "../src/core/data-dir.js";
import { SERVER_ENTRY, baseEnv, makeTempDir } from "./helpers.js";

test("resolveDataDir throws when DATA_DIR is missing or blank", () => {
  assert.throws(() => resolveDataDir({}), /DATA_DIR is not set/);
  assert.throws(() => resolveDataDir({ DATA_DIR: "   " }), /DATA_DIR is not set/);
});

test("resolveDataDir resolves DATA_DIR and creates the folder", (t) => {
  const temp = makeTempDir("mcp-feature-analyzer-datadir-");
  t.after(temp.cleanup);
  const target = path.join(temp.dir, "nested", "data");

  const dataDir = resolveDataDir({ DATA_DIR: `  ${target}  ` });

  assert.equal(dataDir, path.resolve(target));
  assert.ok(fs.statSync(dataDir).isDirectory());
});

test("the server refuses to start without DATA_DIR", () => {
  const result = spawnSync(process.execPath, [SERVER_ENTRY], { env: baseEnv(), input: "", encoding: "utf-8", timeout: 15000 });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATA_DIR is not set/);
});
