import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { AnalysisStore } from "../src/core/analysis-store.js";
import { AnalysisError } from "../src/core/errors.js";
import { addProject, applyMigrations, migrateAnalysis, migrateSnapshot, repoFolderName, type MigrationStep } from "../src/core/migrate.js";
import { makeStore, sampleFinding, sampleSnapshot } from "./helpers.js";

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true }).map(String);
}

test("create writes the analysis and its diff snapshot, pretty-printed", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);

  const analysis = store.create({ project: "demo", title: "Refonte de l'Écran OAuth", request: { text: "Do it", source: "TM-1" } }, sampleSnapshot());
  assert.match(analysis.id, /^refonte-de-l-ecran-oauth-[a-z0-9]{6}$/);
  assert.equal(analysis.revision, 0);
  assert.equal(analysis.lastEditor, "agent");
  assert.equal(analysis.review.state, "pending");
  assert.deepEqual(analysis.request, { text: "Do it", source: "TM-1" });
  assert.equal(analysis.files.length, 2);

  const analysisFile = path.join(dir, "analyses", `${analysis.id}.json`);
  const diffFile = path.join(dir, "diffs", `${analysis.id}.json`);
  assert.ok(fs.readFileSync(analysisFile, "utf-8").includes('\n  "title": '));
  assert.equal(JSON.parse(fs.readFileSync(diffFile, "utf-8")).analysisId, analysis.id);

  const reloaded = new AnalysisStore(dir);
  assert.deepEqual(reloaded.get(analysis.id), analysis);
  assert.equal(reloaded.getSnapshot(analysis.id).files[1].newContent, "one\ntwo\nthree\nfour\nfive\n");
});

test("create rejects an empty title", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  assert.throws(() => store.create({ project: "demo", title: "  " }, sampleSnapshot()), /"title" is required/);
});

test("create requires a project and stores it trimmed, with no overview", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  assert.throws(() => store.create({ project: " ", title: "T" }, sampleSnapshot()), /"project" is required/);
  const created = store.create({ project: "  Billing  ", title: "T" }, sampleSnapshot());
  assert.equal(created.project, "Billing");
  assert.equal(created.overview, null);
});

test("list returns lightweight summaries, most recent first", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const first = store.create({ project: "demo", title: "First" }, sampleSnapshot());
  const second = store.create(
    { project: "demo", title: "Second" },
    sampleSnapshot({ mode: "working_tree", base: "HEAD", head: null, headCommit: null })
  );
  store.mutate(first.id, "user", (draft) => {
    draft.files[1].reviewed = true;
    draft.findings.push(sampleFinding({ id: "f_1", severity: "critical" }));
    draft.findings.push(sampleFinding({ id: "f_2", severity: "critical" }));
    draft.findings.push(sampleFinding({ id: "f_3", severity: "minor", status: "ignored" }));
  });

  const { analyses, unreadable } = store.list();
  assert.deepEqual(unreadable, []);
  assert.deepEqual(
    analyses.map((a) => a.id),
    [first.id, second.id]
  );
  const summary = analyses[0];
  assert.equal(summary.title, "First");
  assert.equal(summary.project, "demo");
  assert.deepEqual(summary.progress, { state: "in_progress", reviewedFiles: 1, totalFiles: 2, decision: null });
  assert.equal(summary.mode, "branch");
  assert.equal(summary.base, "master");
  assert.equal(summary.head, "HEAD");
  assert.equal(summary.fileCount, 2);
  assert.equal(summary.reviewedCount, 1);
  assert.deepEqual(summary.openFindings, { critical: 2, major: 0, minor: 0, trivial: 0 });
  assert.equal(summary.diagramCount, 0);
  assert.equal(summary.reviewState, "pending");
  assert.equal(summary.decision, null);
  assert.equal(summary.revision, 1);
  assert.equal(analyses[1].mode, "working_tree");
});

test("list reports unreadable files instead of hiding them", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);

  const valid = store.create({ project: "demo", title: "Valid" }, sampleSnapshot());
  fs.writeFileSync(path.join(dir, "analyses", "broken-aaaaaa.json"), "{ not json", "utf-8");

  const { analyses, unreadable } = new AnalysisStore(dir).list();
  assert.deepEqual(
    analyses.map((a) => a.id),
    [valid.id]
  );
  assert.equal(unreadable.length, 1);
  assert.equal(unreadable[0].id, "broken-aaaaaa");
  assert.match(unreadable[0].error, /is not readable/);
});

test("mutate bumps the revision, records the editor and persists", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);

  const created = store.create({ project: "demo", title: "Rev" }, sampleSnapshot());
  const afterAgent = store.mutate(created.id, "agent", (draft) => {
    draft.summary = ["Did a thing"];
  });
  assert.equal(afterAgent.revision, 1);
  assert.equal(afterAgent.lastEditor, "agent");

  const afterUser = store.mutate(
    created.id,
    "user",
    (draft) => {
      draft.files[0].reviewed = true;
    },
    { baseRevision: 1 }
  );
  assert.equal(afterUser.revision, 2);
  assert.equal(afterUser.lastEditor, "user");
  assert.deepEqual(new AnalysisStore(dir).get(created.id).summary, ["Did a thing"]);
});

test("mutate refuses an edit based on an outdated revision and writes nothing", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);

  const created = store.create({ project: "demo", title: "Conflict" }, sampleSnapshot());
  store.mutate(created.id, "agent", (draft) => {
    draft.summary = ["agent"];
  });
  assert.throws(
    () =>
      store.mutate(
        created.id,
        "user",
        (draft) => {
          draft.summary = ["user"];
        },
        { baseRevision: 0 }
      ),
    (err: unknown) =>
      err instanceof AnalysisError && /has changed since it was loaded/.test(err.message) && /Reload it/.test(err.message)
  );
  assert.deepEqual(new AnalysisStore(dir).get(created.id).summary, ["agent"]);
});

test("mutate leaves the analysis untouched when the callback throws or breaks a rule", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const created = store.create({ project: "demo", title: "Atomic" }, sampleSnapshot());
  assert.throws(() =>
    store.mutate(created.id, "agent", (draft) => {
      draft.summary.push("partial");
      throw new Error("boom");
    })
  );
  assert.throws(
    () =>
      store.mutate(created.id, "agent", (draft) => {
        draft.findings.push(sampleFinding({ location: { path: "src/a.ts", startLine: 4, endLine: 9 } }));
      }),
    /targets lines 4-9 of "src\/a.ts", which has 5 line\(s\)/
  );
  assert.throws(
    () =>
      store.mutate(created.id, "agent", (draft) => {
        draft.findings.push(sampleFinding({ severity: "blocker" as never }));
      }),
    /Resulting analysis is invalid/
  );
  assert.throws(
    () =>
      store.mutate(created.id, "agent", (draft) => {
        draft.files[0].lineCount = 99;
        draft.baseCommit = "c".repeat(40);
      }),
    /Cannot change baseCommit, files\[0\]\.lineCount .*Use refresh_analysis/
  );
  const stored = store.get(created.id);
  assert.equal(stored.revision, 0);
  assert.deepEqual(stored.summary, []);
  assert.deepEqual(stored.findings, []);
});

test("unknown and invalid ids point the agent to list_analyses", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  assert.throws(() => store.get("nope-123456"), /Analysis "nope-123456" not found\. Use list_analyses/);
  assert.throws(() => store.getSnapshot("nope-123456"), /not found\. Use list_analyses/);
  assert.throws(() => store.mutate("nope-123456", "agent", () => {}), /not found\. Use list_analyses/);
  assert.throws(() => store.delete("nope-123456"), /not found\. Use list_analyses/);
  assert.throws(() => store.get("../escape"), /is not a valid analysis id\. Use list_analyses/);
});

test("delete removes the analysis and its snapshot", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);

  const created = store.create({ project: "demo", title: "Temporary" }, sampleSnapshot());
  store.delete(created.id);
  assert.equal(store.list().analyses.length, 0);
  assert.deepEqual(listFiles(path.join(dir, "analyses")), []);
  assert.deepEqual(listFiles(path.join(dir, "diffs")), []);
});

test("no temporary or lock file remains after writes", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);

  const created = store.create({ project: "demo", title: "Clean" }, sampleSnapshot());
  for (let i = 0; i < 5; i++) {
    store.mutate(created.id, "agent", (draft) => {
      draft.summary.push(`point ${i}`);
    });
  }
  store.replaceSnapshot(created.id, "agent", sampleSnapshot({ snapshotAt: "2026-09-30T00:00:00.000Z" }));
  const leftovers = listFiles(dir).filter((file) => file.endsWith(".tmp") || file.endsWith(".lock"));
  assert.deepEqual(leftovers, []);
});

test("get rejects a file that no longer matches the schema, naming the offending fields", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);

  const created = store.create({ project: "demo", title: "Corrupt" }, sampleSnapshot());
  const file = path.join(dir, "analyses", `${created.id}.json`);
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  raw.mode = "sideways";
  delete raw.files;
  fs.writeFileSync(file, JSON.stringify(raw), "utf-8");

  assert.throws(
    () => new AnalysisStore(dir).get(created.id),
    (err: unknown) =>
      err instanceof AnalysisError &&
      /does not match the expected schema/.test(err.message) &&
      /mode/.test(err.message) &&
      /files/.test(err.message)
  );

  const diffFile = path.join(dir, "diffs", `${created.id}.json`);
  fs.writeFileSync(diffFile, JSON.stringify({ analysisId: created.id, files: [{ path: "x" }] }), "utf-8");
  assert.throws(
    () => new AnalysisStore(dir).getSnapshot(created.id),
    /Diff snapshot of analysis .* does not match the expected schema/
  );
});

test("two store instances on the same directory see each other's writes and never lose one", (t) => {
  const { dir, cleanup } = makeStore();
  t.after(cleanup);

  const a = new AnalysisStore(dir);
  const b = new AnalysisStore(dir);
  const created = a.create({ project: "demo", title: "Shared" }, sampleSnapshot());

  assert.deepEqual(a.get(created.id).summary, []);
  b.mutate(created.id, "agent", (draft) => {
    draft.summary.push("from b");
  });
  assert.deepEqual(a.get(created.id).summary, ["from b"], "A must re-read the file written by B");

  a.mutate(created.id, "user", (draft) => {
    draft.files[1].reviewed = true;
  });
  const onDisk = new AnalysisStore(dir).get(created.id);
  assert.deepEqual(onDisk.summary, ["from b"]);
  assert.equal(onDisk.files[1].reviewed, true);
  assert.equal(onDisk.revision, 2);
});

test("a held lock makes a second writer wait, then fail with a retry message", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);

  const created = store.create({ project: "demo", title: "Locked" }, sampleSnapshot());
  const lockPath = path.join(dir, "analyses", `${created.id}.json.lock`);
  fs.writeFileSync(lockPath, "");
  assert.throws(
    () => new AnalysisStore(dir).mutate(created.id, "agent", () => {}),
    /is being written by another editor .* Try again in a moment/
  );

  const stale = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, stale, stale);
  const updated = new AnalysisStore(dir).mutate(created.id, "agent", (draft) => {
    draft.summary.push("after stale lock");
  });
  assert.equal(updated.revision, 1);
  assert.equal(fs.existsSync(lockPath), false);
});

test("replaceSnapshot rewrites the diff and applies the refresh rules", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);

  const created = store.create({ project: "demo", title: "Refresh" }, sampleSnapshot());
  store.mutate(created.id, "agent", (draft) => {
    draft.findings.push(sampleFinding());
  });
  const next = sampleSnapshot({ snapshotAt: "2026-09-30T00:00:00.000Z" });
  next.diff[1].newContent = "one\ntwo\nTHREE\nfour\nfive\n";

  const { analysis, stats } = store.replaceSnapshot(created.id, "agent", next);
  assert.equal(analysis.snapshotAt, "2026-09-30T00:00:00.000Z");
  assert.equal(analysis.findings[0].status, "outdated");
  assert.equal(stats.findingsOutdated, 1);
  assert.equal(analysis.revision, 2);
  assert.equal(store.getSnapshot(created.id).files[1].newContent, "one\ntwo\nTHREE\nfour\nfive\n");

  assert.throws(
    () => store.replaceSnapshot(created.id, "agent", sampleSnapshot({ base: "develop" })),
    /does not match analysis/
  );
});

test("migrations are wired, idempotent and leave an up-to-date file untouched", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);

  const created = store.create({ project: "demo", title: "Migrate" }, sampleSnapshot());
  const file = path.join(dir, "analyses", `${created.id}.json`);
  const before = fs.readFileSync(file, "utf-8");
  const raw = JSON.parse(before);
  assert.equal(migrateAnalysis(raw), null);
  assert.equal(
    migrateSnapshot(JSON.parse(fs.readFileSync(path.join(dir, "diffs", `${created.id}.json`), "utf-8"))),
    null
  );

  const mtime = fs.statSync(file).mtimeMs;
  new AnalysisStore(dir).get(created.id);
  assert.equal(fs.statSync(file).mtimeMs, mtime, "an up-to-date analysis must not be rewritten");
  assert.equal(fs.readFileSync(file, "utf-8"), before);

  const addSummary: MigrationStep = (doc) => (Array.isArray(doc.summary) ? null : { ...doc, summary: [] });
  const legacy = { ...raw };
  delete legacy.summary;
  const once = applyMigrations(legacy, [addSummary]);
  assert.deepEqual(once?.summary, []);
  assert.equal(applyMigrations(once, [addSummary]), null, "a second pass must change nothing");
  assert.equal(applyMigrations("not an object", [addSummary]), null);
});

test("migration derives the project from the repository folder and adds an empty overview, once", (t) => {
  const { store, dir, cleanup } = makeStore();
  t.after(cleanup);

  const created = store.create({ project: "demo", title: "Legacy" }, sampleSnapshot({ repoPath: "/work/repos/billing-api/" }));
  const file = path.join(dir, "analyses", `${created.id}.json`);
  const legacy = JSON.parse(fs.readFileSync(file, "utf-8"));
  delete legacy.project;
  delete legacy.overview;
  fs.writeFileSync(file, JSON.stringify(legacy, null, 2));

  const migrated = migrateAnalysis(legacy);
  assert.equal(migrated?.project, "billing-api");
  assert.equal(migrated?.overview, null);
  assert.equal(migrateAnalysis(migrated), null, "a second pass must change nothing");

  const reloaded = new AnalysisStore(dir).get(created.id);
  assert.equal(reloaded.project, "billing-api");
  assert.equal(reloaded.overview, null);
  const onDisk = JSON.parse(fs.readFileSync(file, "utf-8"));
  assert.equal(onDisk.project, "billing-api", "the migrated analysis is written back");
  assert.equal(onDisk.revision, legacy.revision);

  assert.equal(repoFolderName("C:\\Users\\me\\code\\shop\\"), "shop");
  assert.equal(repoFolderName("/srv/app"), "app");
  const kept = { ...legacy, project: "Chosen" };
  assert.equal(addProject(kept), null, "an existing project is never replaced");
});

test("migration refuses to guess a project when the repository path has no folder name", () => {
  for (const repoPath of ["/", "C:\\", 42]) {
    assert.throws(
      () => migrateAnalysis({ id: "x-abc123", repoPath }),
      /Cannot derive the project of analysis "x-abc123" from its repoPath .*set "project" in the analysis file/
    );
  }
});
