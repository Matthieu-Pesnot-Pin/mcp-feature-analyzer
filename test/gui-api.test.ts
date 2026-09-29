import assert from "node:assert/strict";
import net from "node:net";
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

  const created = await client.callTool("create_analysis", { repo_path: repo.dir, title: "GUI API", mode: "branch", base: "master" });
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

  const resubmitted = await call("POST", `analyses/${analysisId}/review`, {
    decision: "approve",
    findingIds: [],
    noteIds: [],
    baseRevision: submitted.json.analysis.revision,
  });
  assert.equal(resubmitted.status, 200, resubmitted.json.error);
  assert.equal(resubmitted.json.analysis.review.decision, "approve");
});

test("an unknown API route answers 404 in JSON", async () => {
  const { status, json } = await call("GET", "nothing-here");
  assert.equal(status, 404);
  assert.match(json.error, /Unknown API route/);
});
