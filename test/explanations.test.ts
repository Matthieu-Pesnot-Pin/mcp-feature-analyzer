import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs";
import path from "node:path";

import type { AnalysisStore } from "../src/core/analysis-store.js";
import { findInvariantViolations } from "../src/core/invariants.js";
import { migrateAnalysis } from "../src/core/migrate.js";
import { errorResult, type Args, type MutationResult, type ToolResult } from "../src/tools/types.js";
import { createAnalysis } from "../src/tools/create-analysis.js";
import { getAnalysis } from "../src/tools/get-analysis.js";
import { refreshAnalysis } from "../src/tools/refresh-analysis.js";
import { addExplanations } from "../src/tools/add-explanations.js";
import { updateExplanation } from "../src/tools/update-explanation.js";
import { deleteExplanations } from "../src/tools/delete-explanations.js";
import { APP_LINES, git, makeGitRepo, makeStore, sampleAnalysis } from "./helpers.js";

type Tool = (store: AnalysisStore, args: Args) => ToolResult | MutationResult | Promise<ToolResult | MutationResult>;

async function call(tool: Tool, store: AnalysisStore, args: Args): Promise<{ text: string; isError: boolean }> {
  let result: ToolResult;
  try {
    const out = await tool(store, args);
    result = "result" in out ? (out as MutationResult).result : (out as ToolResult);
  } catch (err) {
    result = errorResult((err as Error).message);
  }
  return { text: result.content.map((entry) => entry.text).join("\n"), isError: result.isError === true };
}

async function ok(tool: Tool, store: AnalysisStore, args: Args): Promise<string> {
  const { text, isError } = await call(tool, store, args);
  assert.equal(isError, false, text);
  return text;
}

async function fails(tool: Tool, store: AnalysisStore, args: Args): Promise<string> {
  const { text, isError } = await call(tool, store, args);
  assert.equal(isError, true, text);
  return text;
}

/**
 * Analyse `master...HEAD` du dépôt de test. Dans `src/app.ts`, la ligne 2 est remplacée
 * (ancienne ligne 2 supprimée) ; `remove.txt` est supprimé.
 */
async function setup(t: TestContext) {
  const repo = makeGitRepo();
  const temp = makeStore();
  t.after(() => {
    repo.cleanup();
    temp.cleanup();
  });
  const text = await ok(createAnalysis, temp.store, { repo_path: repo.dir, project: "demo", title: "Feature X", mode: "branch", base: "master" });
  const id = /\(id: ([a-z0-9-]+)\)/.exec(text)![1];
  return { repo: repo.dir, store: temp.store, id, createText: text };
}

test("create_analysis asks for explanations of long or complex blocks", async (t) => {
  const { createText } = await setup(t);
  assert.match(createText, /Explain every long .* or complex block of added or removed code with add_explanations/);
});

test("add_explanations anchors on new-side and old-side lines and copies their text", async (t) => {
  const { store, id } = await setup(t);
  const text = await ok(addExplanations, store, {
    analysis_id: id,
    explanations: [
      { id: "app", title: "app.ts: numbered lines", body: "Holds the lines.\nOne per row.", path: "src/app.ts", start_line: 1, end_line: 31 },
      { title: "Old line 2", body: "The former second line.", path: "src/app.ts", side: "old", start_line: 1, end_line: 3 },
      { title: "Removed file", body: "What remove.txt held.", path: "remove.txt", side: "old", start_line: 1 },
    ],
  });
  assert.match(text, /Added 3 explanation\(s\)/);
  assert.match(text, /app current — src\/app\.ts:1-31 \(new side\) — app\.ts: numbered lines/);

  const [app, old, removed] = store.get(id).explanations;
  assert.deepEqual(app.location, { path: "src/app.ts", side: "new", startLine: 1, endLine: 31 });
  assert.equal(app.anchorText.split("\n").length, 31);
  assert.equal(app.status, "current");
  assert.equal(old.anchorText, [APP_LINES[0], APP_LINES[1], APP_LINES[2]].join("\n"));
  assert.match(old.id, /^x_[a-z0-9]{6}$/);
  assert.equal(removed.anchorText, "to be removed");

  const analysis = await ok(getAnalysis, store, { analysis_id: id });
  assert.match(analysis, /Explanations \(3: 0 outdated\):/);
  assert.match(analysis, /remove\.txt:1 \(old side\) — Removed file/);
});

test("add_explanations rejects the whole batch when one explanation is invalid", async (t) => {
  const { store, id } = await setup(t);
  const text = await fails(addExplanations, store, {
    analysis_id: id,
    explanations: [
      { title: "Fine", body: "Ok.", path: "src/app.ts", start_line: 1 },
      { title: "Unchanged old lines", body: "x", path: "src/app.ts", side: "old", start_line: 3, end_line: 4 },
      { title: "Outside the diff", body: "x", path: "src/app.ts", side: "old", start_line: 15 },
      { title: "Deleted file, new side", body: "x", path: "remove.txt", start_line: 1 },
      { title: "No location", body: "x" },
      { title: "Empty body", body: " ", path: "src/app.ts", start_line: 1 },
      { title: "Side without lines", body: "x", side: "old" },
    ],
  });
  assert.match(text, /No explanation was added: 6 of 7/);
  assert.match(text, /explanations\[1\]: .*contain no removed line/);
  assert.match(text, /explanations\[2\]: .*not all in the diff \(missing: 15\)/);
  assert.match(text, /explanations\[3\]: .*it is deleted\. Explain its removed lines on the old side/);
  assert.match(text, /explanations\[4\]: an explanation describes lines of code/);
  assert.match(text, /explanations\[5\]: "body" is required/);
  assert.match(text, /explanations\[6\]: .*"side" needs "path"/);
  assert.deepEqual(store.get(id).explanations, []);
});

test("update_explanation rewrites and moves an explanation; delete_explanations removes it", async (t) => {
  const { store, id } = await setup(t);
  await ok(addExplanations, store, {
    analysis_id: id,
    explanations: [{ id: "e1", title: "First", body: "Body.", path: "src/app.ts", start_line: 1, end_line: 5 }],
  });

  assert.match(await ok(updateExplanation, store, { analysis_id: id, explanation_id: "e1", body: "New body." }), /Updated explanation e1 \(body\)/);
  await ok(updateExplanation, store, { analysis_id: id, explanation_id: "e1", path: "src/new file.ts", start_line: 1, end_line: 2 });
  const moved = store.get(id).explanations[0];
  assert.deepEqual([moved.body, moved.location.path, moved.anchorText], ["New body.", "src/new file.ts", "export const added = 1;\nexport const other = 2;"]);

  assert.match(await fails(updateExplanation, store, { analysis_id: id, explanation_id: "e1" }), /Give at least one field/);
  assert.match(await fails(updateExplanation, store, { analysis_id: id, explanation_id: "nope", title: "x" }), /Existing explanations: e1/);
  assert.match(await fails(updateExplanation, store, { analysis_id: id, explanation_id: "e1", path: null }), /cannot be null/);

  assert.match(await fails(deleteExplanations, store, { analysis_id: id, explanation_ids: ["e1", "nope"] }), /No explanation was deleted/);
  assert.match(await ok(deleteExplanations, store, { analysis_id: id, explanation_ids: ["e1"] }), /0 explanation\(s\) remain/);
});

test("refresh_analysis marks explanations outdated when their code changes, and a new location makes them current", async (t) => {
  const { repo, store, id } = await setup(t);
  await ok(addExplanations, store, {
    analysis_id: id,
    explanations: [
      { id: "top", title: "Top", body: "Lines 1 to 5.", path: "src/app.ts", start_line: 1, end_line: 5 },
      { id: "tail", title: "Tail", body: "Last lines.", path: "src/app.ts", start_line: 29, end_line: 31 },
    ],
  });

  const app = fs.readFileSync(path.join(repo, "src/app.ts"), "utf-8").split("\n");
  app[2] = "line 3 rewritten";
  fs.writeFileSync(path.join(repo, "src/app.ts"), app.join("\n"));
  git(repo, "commit", "-q", "-am", "rewrite line 3");

  const text = await ok(refreshAnalysis, store, { analysis_id: id });
  assert.match(text, /Explanations: 1 became outdated/);
  assert.match(text, /Outdated explanations:\n {2}top outdated — src\/app\.ts:1-5/);
  assert.deepEqual(store.get(id).explanations.map((entry) => [entry.id, entry.status]), [["top", "outdated"], ["tail", "current"]]);

  const updated = await ok(updateExplanation, store, { analysis_id: id, explanation_id: "top", path: "src/app.ts", start_line: 1, end_line: 5 });
  assert.match(updated, /made it current again/);
  assert.equal(store.get(id).explanations[0].anchorText.split("\n")[2], "line 3 rewritten");
});

test("an explanation on a file that left the analysis is an invariant violation only while current", () => {
  const analysis = sampleAnalysis({
    explanations: [
      {
        id: "gone",
        title: "Gone",
        body: "x",
        location: { path: "missing.ts", side: "new", startLine: 1, endLine: 2 },
        anchorText: "a\nb",
        status: "current",
        createdAt: "2026-09-29T10:00:00.000Z",
      },
    ],
  });
  assert.deepEqual(findInvariantViolations(analysis), [
    'explanation "gone" describes "missing.ts", which is not a changed file of this analysis',
  ]);
  analysis.explanations[0].status = "outdated";
  assert.deepEqual(findInvariantViolations(analysis), []);
});

test("an analysis stored without explanations is migrated with an empty list", () => {
  const { explanations, ...stored } = sampleAnalysis();
  assert.deepEqual(migrateAnalysis(stored)?.explanations, []);
  assert.equal(migrateAnalysis({ ...stored, explanations }), null);
});
