import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import test, { after, before } from "node:test";

import { McpClient, baseEnv, makeGitRepo, makeTempDir } from "./helpers.js";

/**
 * API REST du GUI worker en mode standalone (APP_PORT) : un vrai serveur MCP
 * sur stdio, son worker sur un port libre, et la boucle agent → GUI → agent.
 */

let client: McpClient;
let temp: { dir: string; cleanup: () => void };
let repo: { dir: string; cleanup: () => void };
let baseUrl = "";
let analysisId = "";

/** Port TCP libre attribué par le système. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/proxy/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Le worker n'écoute pas encore.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`the GUI worker never answered on ${url}. stderr:\n${client.stderr.join("")}`);
}

async function call(method: string, route: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${baseUrl}/api/${route}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

async function revision(): Promise<number> {
  const { json } = await call("GET", `analyses/${analysisId}`);
  return json.analysis.revision;
}

before(async () => {
  temp = makeTempDir("mcp-feature-analyzer-gui-api-");
  repo = makeGitRepo();
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  client = new McpClient({ ...baseEnv(), MCP_FEATURE_ANALYZER_DATA_DIR: temp.dir, APP_PORT: String(port) });
  await client.initialize("mcp-feature-analyzer-gui-api");
  await waitForHealth(baseUrl, 20000);

  const created = await client.callTool("create_analysis", { repo_path: repo.dir, project: "demo", title: "GUI API", mode: "branch", base: "master" });
  assert.equal(created.isError, false, created.text);
  assert.match(created.text, new RegExp(`Open the review: http://localhost:${port}#/`));
  analysisId = /\(id: ([a-z0-9-]+)\)/.exec(created.text)![1];

  const added = await client.callTool("add_findings", {
    analysis_id: analysisId,
    findings: [
      { id: "f_bug", severity: "critical", title: "Broken line", body: "Line 2 is wrong", path: "src/app.ts", start_line: 2, suggestion: "line 2 fixed" },
      { id: "f_minor", severity: "minor", title: "Style", body: "Rename", path: "src/app.ts", start_line: 26 },
      { id: "f_gap", severity: "major", kind: "requirement_gap", title: "Missing retry", body: "The ticket asks for a retry" },
    ],
  });
  assert.equal(added.isError, false, added.text);
});

after(async () => {
  await client?.stop();
  repo?.cleanup();
  temp?.cleanup();
});

test("GET /api/analyses lists the analysis summaries", async () => {
  const { status, json } = await call("GET", "analyses");
  assert.equal(status, 200);
  assert.deepEqual(json.unreadable, []);
  assert.equal(json.analyses.length, 1);
  assert.equal(json.analyses[0].id, analysisId);
  assert.deepEqual(json.analyses[0].openFindings, { critical: 1, major: 1, minor: 1, trivial: 0 });
  assert.equal(json.analyses[0].project, "demo");
  assert.deepEqual(json.analyses[0].progress, { state: "not_started", reviewedFiles: 0, totalFiles: 7, decision: null, processed: null, toProcess: false });
});

test("GET /api/analyses/:id and /diff return the analysis and its frozen diff", async () => {
  const analysis = await call("GET", `analyses/${analysisId}`);
  assert.equal(analysis.status, 200);
  assert.equal(analysis.json.analysis.title, "GUI API");
  assert.equal(analysis.json.analysis.findings.length, 3);

  const diff = await call("GET", `analyses/${analysisId}/diff`);
  assert.equal(diff.status, 200);
  assert.equal(diff.json.diff.analysisId, analysisId);
  const app = diff.json.diff.files.find((file: { path: string }) => file.path === "src/app.ts");
  assert.ok(app.hunks.length > 0);

  const missing = await call("GET", "analyses/does-not-exist/diff");
  assert.equal(missing.status, 404);
  assert.match(missing.json.error, /not found/);
});

test("POST files/reviewed marks a file reviewed and validates the body", async () => {
  const done = await call("POST", `analyses/${analysisId}/files/reviewed`, { path: "src/app.ts", reviewed: true, baseRevision: await revision() });
  assert.equal(done.status, 200, done.json.error);
  assert.equal(done.json.analysis.files.find((file: { path: string }) => file.path === "src/app.ts").reviewed, true);

  const invalid = await call("POST", `analyses/${analysisId}/files/reviewed`, { path: "src/app.ts", baseRevision: await revision() });
  assert.equal(invalid.status, 400);
  assert.match(invalid.json.error, /^Invalid request body: reviewed/);

  const unknown = await call("POST", `analyses/${analysisId}/files/reviewed`, { path: "nope.ts", reviewed: true, baseRevision: await revision() });
  assert.equal(unknown.status, 404);
  assert.match(unknown.json.error, /"nope\.ts" is not part of analysis/);
});

test("POST findings/:id/status ignores a finding and refuses outdated", async () => {
  const ignored = await call("POST", `analyses/${analysisId}/findings/f_minor/status`, { status: "ignored", baseRevision: await revision() });
  assert.equal(ignored.status, 200, ignored.json.error);
  assert.equal(ignored.json.analysis.findings.find((finding: { id: string }) => finding.id === "f_minor").status, "ignored");

  const outdated = await call("POST", `analyses/${analysisId}/findings/f_bug/status`, { status: "outdated", baseRevision: await revision() });
  assert.equal(outdated.status, 400);
  assert.match(outdated.json.error, /only refresh_analysis does it/);

  const unknown = await call("POST", `analyses/${analysisId}/findings/f_none/status`, { status: "open", baseRevision: await revision() });
  assert.equal(unknown.status, 404);
});

test("POST notes adds a note, refuses an invalid line, and DELETE removes a note", async () => {
  const added = await call("POST", `analyses/${analysisId}/notes`, {
    path: "src/app.ts",
    line: 2,
    text: "Use the shared helper",
    baseRevision: await revision(),
  });
  assert.equal(added.status, 200, added.json.error);
  assert.equal(added.json.analysis.notes.length, 1);
  assert.deepEqual(added.json.analysis.notes[0].location, { path: "src/app.ts", line: 2 });
  assert.equal(added.json.analysis.notes[0].findingId, null);

  const badLine = await call("POST", `analyses/${analysisId}/notes`, { path: "src/app.ts", line: 999, text: "Out", baseRevision: await revision() });
  assert.equal(badLine.status, 400);
  assert.match(badLine.json.error, /Line 999 is out of range for "src\/app\.ts"/);

  const empty = await call("POST", `analyses/${analysisId}/notes`, { path: "src/app.ts", text: "   ", baseRevision: await revision() });
  assert.equal(empty.status, 400);

  const fileNote = await call("POST", `analyses/${analysisId}/notes`, { path: "logo.bin", text: "Temporary", baseRevision: await revision() });
  assert.equal(fileNote.status, 200, fileNote.json.error);
  const temporary = fileNote.json.analysis.notes.find((note: { text: string }) => note.text === "Temporary");
  assert.deepEqual(temporary.location, { path: "logo.bin", line: null });

  const deleted = await call("DELETE", `analyses/${analysisId}/notes/${temporary.id}`, { baseRevision: await revision() });
  assert.equal(deleted.status, 200, deleted.json.error);
  assert.equal(deleted.json.analysis.notes.length, 1);

  const again = await call("DELETE", `analyses/${analysisId}/notes/${temporary.id}`, { baseRevision: await revision() });
  assert.equal(again.status, 404);
});

test("PATCH notes replaces the text of a note and refuses an empty text or an unknown note", async () => {
  const added = await call("POST", `analyses/${analysisId}/notes`, { path: "logo.bin", text: "First wording", baseRevision: await revision() });
  assert.equal(added.status, 200, added.json.error);
  const note = added.json.analysis.notes.find((entry: { text: string }) => entry.text === "First wording");

  const updated = await call("PATCH", `analyses/${analysisId}/notes/${note.id}`, { text: "  Second wording  ", baseRevision: await revision() });
  assert.equal(updated.status, 200, updated.json.error);
  const edited = updated.json.analysis.notes.find((entry: { id: string }) => entry.id === note.id);
  assert.equal(edited.text, "Second wording");
  assert.deepEqual(edited.location, note.location);
  assert.equal(edited.createdAt, note.createdAt);

  const empty = await call("PATCH", `analyses/${analysisId}/notes/${note.id}`, { text: "   ", baseRevision: await revision() });
  assert.equal(empty.status, 400);

  const unknown = await call("PATCH", `analyses/${analysisId}/notes/n_none`, { text: "Text", baseRevision: await revision() });
  assert.equal(unknown.status, 404);

  const deleted = await call("DELETE", `analyses/${analysisId}/notes/${note.id}`, { baseRevision: await revision() });
  assert.equal(deleted.status, 200, deleted.json.error);
});

test("POST notes links a note to the finding it answers and refuses an unknown finding", async () => {
  const linked = await call("POST", `analyses/${analysisId}/notes`, {
    path: "src/app.ts",
    line: 2,
    findingId: "f_bug",
    text: "Answer to the finding",
    baseRevision: await revision(),
  });
  assert.equal(linked.status, 200, linked.json.error);
  const note = linked.json.analysis.notes.find((entry: { text: string }) => entry.text === "Answer to the finding");
  assert.equal(note.findingId, "f_bug");

  const unknown = await call("POST", `analyses/${analysisId}/notes`, {
    path: "src/app.ts",
    line: 2,
    findingId: "f_none",
    text: "Orphan",
    baseRevision: await revision(),
  });
  assert.equal(unknown.status, 404);
  assert.match(unknown.json.error, /Finding "f_none" not found/);

  const deleted = await call("DELETE", `analyses/${analysisId}/notes/${note.id}`, { baseRevision: await revision() });
  assert.equal(deleted.status, 200, deleted.json.error);
});

test("a change based on an old revision is refused with 409", async () => {
  const stale = (await revision()) - 1;
  const conflict = await call("POST", `analyses/${analysisId}/files/reviewed`, { path: "src/app.ts", reviewed: false, baseRevision: stale });
  assert.equal(conflict.status, 409);
  assert.match(conflict.json.error, /has changed since it was loaded/);
});

test("POST review submits the review, and get_review_feedback returns it to the agent", async () => {
  const { json } = await call("GET", `analyses/${analysisId}`);
  const noteId = json.analysis.notes[0].id;

  const unknown = await call("POST", `analyses/${analysisId}/review`, {
    decision: "request_changes",
    findingIds: ["f_none"],
    noteIds: [],
    baseRevision: json.analysis.revision,
  });
  assert.equal(unknown.status, 400);
  assert.match(unknown.json.error, /Unknown finding id\(s\) in the selection: f_none/);

  const submitted = await call("POST", `analyses/${analysisId}/review`, {
    decision: "request_changes",
    findingIds: ["f_bug", "f_gap"],
    noteIds: [noteId],
    baseRevision: json.analysis.revision,
  });
  assert.equal(submitted.status, 200, submitted.json.error);
  const review = submitted.json.analysis.review;
  assert.equal(review.state, "submitted");
  assert.equal(review.decision, "request_changes");
  assert.ok(review.submittedAt);
  assert.match(review.prompt, /\[Critical\] src\/app\.ts:2 — Broken line/);

  const feedback = await client.callTool("get_review_feedback", { analysis_id: analysisId });
  assert.equal(feedback.isError, false, feedback.text);
  assert.match(feedback.text, /Decision: request_changes/);
  assert.match(feedback.text, /Decision: Request changes\./);
  assert.match(feedback.text, /1\. \[Critical\] src\/app\.ts:2 — Broken line/);
  assert.match(feedback.text, /Missing requirement: Missing retry/);
  assert.match(feedback.text, /\[Reviewer note\] src\/app\.ts:2 — Use the shared helper/);
  assert.doesNotMatch(feedback.text, /Style/);

  const processed = await client.callTool("mark_feedback_processed", { analysis_id: analysisId, note: "fixed by 12785d6e3" });
  assert.equal(processed.isError, false, processed.text);
  const afterProcessing = await call("GET", `analyses/${analysisId}`);
  assert.equal(afterProcessing.json.analysis.review.processed.note, "fixed by 12785d6e3");

  const reworded = await call("PATCH", `analyses/${analysisId}/notes/${noteId}`, {
    text: "Reuse the shared helper",
    baseRevision: afterProcessing.json.analysis.revision,
  });
  assert.equal(reworded.status, 200, reworded.json.error);
  const reopened = reworded.json.analysis.review;
  assert.equal(reopened.state, "pending");
  assert.equal(reopened.processed, null);
  assert.equal(reopened.previousSubmission.decision, "request_changes");
  assert.equal(reopened.previousSubmission.processed.note, "fixed by 12785d6e3");
  assert.deepEqual(reopened.previousSubmission.notes.map((note: { text: string }) => note.text), ["Use the shared helper"]);
  const pendingFeedback = await client.callTool("get_review_feedback", { analysis_id: analysisId });
  assert.match(pendingFeedback.text, /is not submitted yet/);
  assert.match(pendingFeedback.text, /The reviewer reopened the feedback submitted at .+, decision request_changes, processed at .+ \(note: fixed by 12785d6e3\)/);
  assert.doesNotMatch(pendingFeedback.text, /Use the shared helper/);

  const resubmitted = await call("POST", `analyses/${analysisId}/review`, {
    decision: "reject",
    findingIds: [],
    noteIds: [noteId],
    baseRevision: reworded.json.analysis.revision,
  });
  assert.equal(resubmitted.status, 200, resubmitted.json.error);
  assert.equal(resubmitted.json.analysis.review.decision, "reject");
  assert.equal(resubmitted.json.analysis.review.processed, null);
  const changed = await client.callTool("get_review_feedback", { analysis_id: analysisId });
  assert.match(changed.text, /Processing: to process/);
  assert.match(changed.text, /Changes since the previous submission \(submitted at .+, decision request_changes, processed at .+ \(note: fixed by 12785d6e3\)\):/);
  assert.match(changed.text, /Decision changed: request_changes → reject/);
  assert.match(changed.text, /- finding f_bug — Broken line/);
  assert.match(changed.text, /~ note .+ — src\/app\.ts:2\n {6}Reuse the shared helper\n {4}was: src\/app\.ts:2\n {6}Use the shared helper/);
});

test("POST review/processed marks the submitted feedback processed by the reviewer", async () => {
  const { json } = await call("GET", `analyses/${analysisId}`);
  assert.equal(json.analysis.review.state, "submitted");

  const empty = await call("POST", `analyses/${analysisId}/review/processed`, { note: "  ", baseRevision: json.analysis.revision });
  assert.equal(empty.status, 400);
  assert.match(empty.json.error, /the note is empty/);

  const marked = await call("POST", `analyses/${analysisId}/review/processed`, {
    note: "fixed in 1ff5baaad",
    baseRevision: json.analysis.revision,
  });
  assert.equal(marked.status, 200, marked.json.error);
  const processed = marked.json.analysis.review.processed;
  assert.equal(processed.note, "fixed in 1ff5baaad");
  assert.equal(processed.by, "user");

  const listed = await call("GET", "analyses");
  assert.equal(listed.json.analyses.find((summary: { id: string }) => summary.id === analysisId).progress.toProcess, false);
  const feedback = await client.callTool("get_review_feedback", { analysis_id: analysisId });
  assert.match(feedback.text, /Processing: processed at .+ by the reviewer \(note: fixed in 1ff5baaad\)/);

  const stale = await call("POST", `analyses/${analysisId}/review/processed`, { note: null, baseRevision: json.analysis.revision });
  assert.equal(stale.status, 409);
});

test("GET /api/changes answers a reset first, then the events pushed by the master", async () => {
  const first = await call("GET", "changes");
  assert.equal(first.status, 200);
  assert.equal(first.json.reset, true);
  assert.equal(typeof first.json.epoch, "string");
  assert.ok(Number.isInteger(first.json.seq));
  const { epoch, seq } = first.json;

  const idle = await call("GET", `changes?since=${seq}&epoch=${epoch}`);
  assert.deepEqual(idle.json, { epoch, seq, reset: false, events: [] });

  const added = await client.callTool("add_findings", {
    analysis_id: analysisId,
    findings: [{ id: "f_changes", severity: "trivial", title: "Typo", body: "Typo", path: "src/app.ts", start_line: 3 }],
  });
  assert.equal(added.isError, false, added.text);

  // L'évènement arrive au worker par IPC, sans ordre garanti avec la réponse de l'outil.
  let changes = idle;
  const deadline = Date.now() + 5000;
  while (changes.json.events?.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    changes = await call("GET", `changes?since=${seq}&epoch=${epoch}`);
  }
  assert.equal(changes.json.reset, false);
  assert.equal(changes.json.epoch, epoch);
  assert.ok(changes.json.seq > seq);
  assert.deepEqual(
    changes.json.events.map((event: { type: string; data: { analysisId?: string } }) => [event.type, event.data.analysisId]),
    [["ANALYSIS_UPDATED", analysisId]],
  );
});

test("GET /api/changes answers a reset for another epoch or a cursor ahead of the journal", async () => {
  const { json: current } = await call("GET", "changes");

  const otherEpoch = await call("GET", `changes?since=${current.seq}&epoch=not-this-worker`);
  assert.deepEqual(otherEpoch.json, { epoch: current.epoch, seq: current.seq, reset: true });

  const ahead = await call("GET", `changes?since=${current.seq + 1}&epoch=${current.epoch}`);
  assert.deepEqual(ahead.json, { epoch: current.epoch, seq: current.seq, reset: true });
});

test("GET /api/changes refuses an invalid since with 400", async () => {
  for (const since of ["abc", "-1", "1.5"]) {
    const { status, json } = await call("GET", `changes?since=${since}&epoch=x`);
    assert.equal(status, 400);
    assert.match(json.error, /^Invalid "since" query parameter/);
  }
});

test("an unknown API route answers 404 in JSON", async () => {
  const { status, json } = await call("GET", "nothing-here");
  assert.equal(status, 404);
  assert.match(json.error, /Unknown API route/);
});

/** Requête HTTP brute : `fetch` interdit de fixer l'en-tête Host. */
function raw(method: string, route: string, headers: Record<string, string>, body?: string): Promise<{ status: number; json: any }> {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname, port, path: `/api/${route}`, method, headers }, (response) => {
      let text = "";
      response.on("data", (chunk) => (text += chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, json: JSON.parse(text) }));
    });
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

test("the worker listens on the loopback interface only", async () => {
  const external = Object.values(os.networkInterfaces())
    .flat()
    .find((address) => address !== undefined && address.family === "IPv4" && !address.internal);
  if (external === undefined) return;
  const { port } = new URL(baseUrl);
  const reached = await new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: external.address, port: Number(port) });
    socket.setTimeout(2000);
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => (socket.destroy(), resolve(false)));
  });
  assert.equal(reached, false, `the worker answered on ${external.address}:${port}`);
});

test("a request whose Host is not the local machine is refused", async () => {
  const { status, json } = await raw("GET", "analyses", { Host: "attacker.example:80" });
  assert.equal(status, 403);
  assert.match(json.error, /Host "attacker\.example:80" is not allowed/);
});

async function markReviewed(reviewed: boolean, headers: Record<string, string>) {
  const { port } = new URL(baseUrl);
  const body = JSON.stringify({ path: "src/app.ts", reviewed, baseRevision: await revision() });
  return raw(
    "POST",
    `analyses/${analysisId}/files/reviewed`,
    { "Content-Type": "application/json", Host: `localhost:${port}`, ...headers },
    body
  );
}

test("a modification sent from another site is refused", async () => {
  const bySecFetch = await markReviewed(true, { Origin: "http://localhost:3000", "Sec-Fetch-Site": "cross-site" });
  assert.equal(bySecFetch.status, 403);
  assert.match(bySecFetch.json.error, /Cross-site request refused/);
  const byOrigin = await markReviewed(true, { Origin: "http://attacker.example" });
  assert.equal(byOrigin.status, 403);
  assert.match(byOrigin.json.error, /Cross-site request refused/);
});

test("a modification relayed by the proxy, whose origin differs from the worker's Host, is accepted", async () => {
  const local = await markReviewed(true, { Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin" });
  assert.equal(local.status, 200, local.json.error);
  const external = Object.values(os.networkInterfaces())
    .flat()
    .find((address) => address !== undefined && address.family === "IPv4" && !address.internal);
  const lanOrigin = `http://${external?.address ?? "127.0.0.1"}:3000`;
  const fromLan = await markReviewed(false, { Origin: lanOrigin });
  assert.equal(fromLan.status, 200, fromLan.json.error);
});
