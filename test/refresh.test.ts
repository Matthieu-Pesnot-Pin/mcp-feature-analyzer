import assert from "node:assert/strict";
import test from "node:test";

import { applyRefresh } from "../src/core/refresh.js";
import type { ComputedSnapshot } from "../src/core/git.js";
import type { DiffSnapshot } from "../shared/schemas/diff.schema.js";
import { sampleAnalysis, sampleFinding, sampleSnapshot } from "./helpers.js";

function oldSnapshotOf(computed: ComputedSnapshot): DiffSnapshot {
  return { analysisId: "sample-abc123", files: structuredClone(computed.diff) };
}

/** Snapshot suivant dont `src/a.ts` a un nouveau contenu et, si `changeHunks`, un diff différent. */
function nextWithContent(content: string, changeHunks: boolean): ComputedSnapshot {
  const next = sampleSnapshot({ snapshotAt: "2026-09-30T00:00:00.000Z", baseCommit: "c".repeat(40) });
  next.diff[1].newContent = content;
  if (changeHunks) next.diff[1].hunks[0].lines[2].text = "two!";
  return next;
}

test("keeps reviewed only for files whose diff is unchanged, and resets it for binaries", () => {
  const initial = sampleSnapshot();
  const analysis = sampleAnalysis();
  analysis.files[0].reviewed = true;
  analysis.files[1].reviewed = true;

  const same = applyRefresh(analysis, oldSnapshotOf(initial), sampleSnapshot({ snapshotAt: "2026-09-30T00:00:00.000Z" }));
  assert.deepEqual(same.fields.files.map((file) => [file.path, file.reviewed]), [
    ["img.png", false],
    ["src/a.ts", true],
  ]);
  assert.equal(same.stats.reviewedKept, 1);
  assert.equal(same.stats.reviewedReset, 1);
  assert.equal(same.fields.snapshotAt, "2026-09-30T00:00:00.000Z");

  const changed = applyRefresh(analysis, oldSnapshotOf(initial), nextWithContent("one\ntwo!\nthree\nfour\nfive\n", true));
  assert.equal(changed.fields.files[1].reviewed, false);
  assert.equal(changed.stats.reviewedReset, 2);
  assert.equal(changed.fields.baseCommit, "c".repeat(40));
});

test("counts files added to and removed from the diff", () => {
  const initial = sampleSnapshot();
  const next = sampleSnapshot();
  next.files = [next.files[1], { ...next.files[1], path: "src/b.ts" }];
  next.diff = [next.diff[1], { ...next.diff[1], path: "src/b.ts" }];

  const { stats, fields } = applyRefresh(sampleAnalysis(), oldSnapshotOf(initial), next);
  assert.deepEqual([stats.fileCount, stats.filesAdded, stats.filesRemoved], [2, 1, 1]);
  assert.deepEqual(fields.files.map((file) => file.path), ["src/a.ts", "src/b.ts"]);
});

test("an open finding whose lines changed becomes outdated", () => {
  const analysis = sampleAnalysis({ findings: [sampleFinding()] });
  const { fields, stats } = applyRefresh(
    analysis,
    oldSnapshotOf(sampleSnapshot()),
    nextWithContent("one\ntwo\nTHREE\nfour\nfive\n", true)
  );
  assert.equal(fields.findings[0].status, "outdated");
  assert.equal(stats.findingsOutdated, 1);
});

test("an open finding stays open when its lines are unchanged, even if the diff moved", () => {
  const analysis = sampleAnalysis({ findings: [sampleFinding()] });
  const { fields, stats } = applyRefresh(
    analysis,
    oldSnapshotOf(sampleSnapshot()),
    nextWithContent("one\ntwo\nthree\nfour\nfive\nsix\n", true)
  );
  assert.equal(fields.findings[0].status, "open");
  assert.equal(stats.findingsOutdated, 0);
});

test("an open finding whose file left the diff becomes outdated", () => {
  const next = sampleSnapshot();
  next.files = [next.files[0]];
  next.diff = [next.diff[0]];
  const { fields, stats } = applyRefresh(sampleAnalysis({ findings: [sampleFinding()] }), oldSnapshotOf(sampleSnapshot()), next);
  assert.equal(fields.findings[0].status, "outdated");
  assert.equal(stats.findingsOutdated, 1);
  assert.equal(stats.filesRemoved, 1);
});

test("an outdated finding whose text matches again returns to open", () => {
  const analysis = sampleAnalysis({ findings: [sampleFinding({ status: "outdated" })] });
  const { fields, stats } = applyRefresh(analysis, oldSnapshotOf(sampleSnapshot()), sampleSnapshot());
  assert.equal(fields.findings[0].status, "open");
  assert.equal(stats.findingsRestored, 1);
});

test("an ignored finding stays ignored whether its text matches or not", () => {
  const analysis = sampleAnalysis({
    findings: [sampleFinding({ id: "f_match", status: "ignored" }), sampleFinding({ id: "f_diff", status: "ignored" })],
  });
  analysis.findings[1].anchorText = "something else";
  const { fields, stats } = applyRefresh(analysis, oldSnapshotOf(sampleSnapshot()), nextWithContent("x\n", true));
  assert.deepEqual(fields.findings.map((finding) => finding.status), ["ignored", "ignored"]);
  assert.deepEqual([stats.findingsOutdated, stats.findingsRestored], [0, 0]);
});

test("a finding without location is left alone", () => {
  const gap = sampleFinding({ kind: "requirement_gap", location: null, anchorText: null });
  const { fields } = applyRefresh(sampleAnalysis({ findings: [gap] }), oldSnapshotOf(sampleSnapshot()), nextWithContent("x\n", true));
  assert.deepEqual(fields.findings[0], gap);
});

test("refuses a snapshot computed with other refs", () => {
  assert.throws(
    () => applyRefresh(sampleAnalysis(), oldSnapshotOf(sampleSnapshot()), sampleSnapshot({ head: "other" })),
    /does not match analysis "sample-abc123"/
  );
});
