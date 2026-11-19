import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";

import { AnalysisStore } from "../src/core/analysis-store.js";
import { addNoteQuestions } from "../src/core/migrate.js";
import {
  ReviewEventScanner,
  formatEvent,
  listenedProjects,
  liveWatcherSince,
  projectKey,
  writeHandoff,
  writeWatcherBeat,
} from "../src/core/notifications.js";
import { addNote, answerQuestion, markAnswerSeen, submitReview, updateNote } from "../src/core/review-actions.js";
import { McpClient, SERVER_ENTRY, baseEnv, makeGitRepo, makeStore, makeTempDir, sampleSnapshot } from "./helpers.js";

/**
 * Questions envoyées tout de suite à l'agent et notifications : actions du store,
 * événements annoncés, outils MCP et veilleur lancé par `--watch`.
 */

function createAnalysis(store: AnalysisStore, project = "demo", title = "Refresh") {
  return store.create({ project, title }, sampleSnapshot());
}

function ask(store: AnalysisStore, id: string, text: string, line: number | null = 2) {
  return addNote(store, id, { path: "src/a.ts", line, text, askAgent: true, baseRevision: store.get(id).revision });
}

test("a question is a note sent to the agent: no reopening, no edit, one answer, read once", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const analysis = createAnalysis(store);
  submitReview(store, analysis.id, { decision: "approve", findingIds: [], noteIds: [], baseRevision: store.get(analysis.id).revision });

  const asked = ask(store, analysis.id, "Why http.post?");
  assert.equal(asked.review.state, "submitted", "a question keeps the submitted review as it is");
  const question = asked.notes[0];
  assert.ok(question.question !== null);
  assert.equal(question.question.answer, null);

  assert.throws(() => updateNote(store, analysis.id, question.id, { text: "Other", baseRevision: store.get(analysis.id).revision }), /cannot change/);
  assert.throws(() => markAnswerSeen(store, analysis.id, question.id, { baseRevision: store.get(analysis.id).revision }), /not answered/);

  const answered = answerQuestion(store, analysis.id, question.id, "To bypass the interceptor.");
  assert.equal(answered.lastEditor, "agent");
  assert.equal(answered.notes[0].question?.answer?.text, "To bypass the interceptor.");
  assert.throws(() => answerQuestion(store, analysis.id, question.id, "Again"), /already answered/);

  const seen = markAnswerSeen(store, analysis.id, question.id, { baseRevision: store.get(analysis.id).revision });
  assert.ok(seen.notes[0].question?.answerSeenAt);
});

test("a regular note is not a question, and a question cannot be selected in the review", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const analysis = createAnalysis(store);
  const withNote = addNote(store, analysis.id, { path: "src/a.ts", line: 2, text: "Rename", baseRevision: 0 });
  assert.equal(withNote.notes[0].question, null);
  assert.throws(() => answerQuestion(store, analysis.id, withNote.notes[0].id, "Done"), /is not a question/);

  const withQuestion = ask(store, analysis.id, "Why?");
  const questionId = withQuestion.notes[1].id;
  assert.throws(
    () => submitReview(store, analysis.id, { decision: "request_changes", findingIds: [], noteIds: [questionId], baseRevision: withQuestion.revision }),
    /cannot be selected/
  );
});

test("the scanner announces unanswered questions and submitted reviews of one project after the cursor", (t) => {
  const { store, cleanup } = makeStore();
  t.after(cleanup);
  const mine = createAnalysis(store, "demo", "Mine");
  const other = createAnalysis(store, "other", "Other");
  const scanner = new ReviewEventScanner(store, "demo");
  const start = Date.now() - 1;

  ask(store, mine.id, "First?");
  ask(store, other.id, "Elsewhere?");
  const events = scanner.since(start);
  assert.deepEqual(events.map((event) => event.kind), ["question"]);
  assert.match(formatEvent(events[0]), /^\[feature-analyzer\] "Mine" \(.+\) — the reviewer asks you on src\/a\.ts:2: First\? — answer with answer_question, analysis_id .+, question_id n_[a-z0-9]+$/);

  answerQuestion(store, mine.id, events[0].kind === "question" ? events[0].questionId : "", "Yes.");
  assert.deepEqual(scanner.since(start), [], "an answered question is not announced any more");

  submitReview(store, mine.id, { decision: "request_changes", findingIds: [], noteIds: [], baseRevision: store.get(mine.id).revision });
  const submitted = scanner.since(start);
  assert.equal(submitted.length, 1);
  assert.match(formatEvent(submitted[0]), /submitted the review and requests changes \(0 finding\(s\) and 0 note\(s\) selected\) — read it with get_review_feedback/);
  assert.deepEqual(scanner.since(submitted[0].eventMs), []);
});

test("watcher beats tell which projects are listened to", (t) => {
  const temp = makeTempDir("mcp-feature-analyzer-beats-");
  t.after(temp.cleanup);
  assert.equal(liveWatcherSince(temp.dir, "demo"), null);
  writeWatcherBeat(temp.dir, "demo", "2026-11-19T10:00:00.000Z");
  assert.equal(liveWatcherSince(temp.dir, "demo"), "2026-11-19T10:00:00.000Z");
  assert.deepEqual(listenedProjects(temp.dir), ["demo"]);
});

test("addNoteQuestions sets question to null on the notes that have none", () => {
  const migrated = addNoteQuestions({ notes: [{ id: "n1" }, { id: "n2", question: null }] });
  assert.deepEqual(migrated?.notes, [
    { id: "n1", question: null },
    { id: "n2", question: null },
  ]);
  assert.equal(addNoteQuestions({ notes: [{ id: "n1", question: null }] }), null);
});

// --- Outils MCP et veilleur -------------------------------------------------------------

let client: McpClient;
let temp: { dir: string; cleanup: () => void };
let home: { dir: string; cleanup: () => void };
let repo: { dir: string; cleanup: () => void };
let analysisId = "";
let previousHome: { HOME?: string; USERPROFILE?: string };

before(async () => {
  temp = makeTempDir("mcp-feature-analyzer-notify-");
  home = makeTempDir("mcp-feature-analyzer-home-");
  repo = makeGitRepo();
  previousHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home.dir;
  process.env.USERPROFILE = home.dir;
  client = new McpClient({ ...baseEnv(), DATA_DIR: temp.dir, HOME: home.dir, USERPROFILE: home.dir });
  await client.initialize("mcp-feature-analyzer-notify");
  const created = await client.callTool("create_analysis", { repo_path: repo.dir, project: "demo", title: "Notify", mode: "branch", base: "master" });
  assert.equal(created.isError, false, created.text);
  analysisId = /\(id: ([a-z0-9-]+)\)/.exec(created.text)![1];
});

after(async () => {
  await client?.stop();
  process.env.HOME = previousHome.HOME;
  process.env.USERPROFILE = previousHome.USERPROFILE;
  repo?.cleanup();
  home?.cleanup();
  temp?.cleanup();
});

/** Ajoute une question comme le ferait la GUI, sur le même dossier de données. */
function askFromGui(text: string): string {
  const store = new AnalysisStore(temp.dir);
  const analysis = addNote(store, analysisId, { path: "src/app.ts", line: 2, text, askAgent: true, baseRevision: store.get(analysisId).revision });
  return analysis.notes[analysis.notes.length - 1].id;
}

test("enable_notifications refuses an unknown project and hands the Monitor call for a known one", async () => {
  const unknown = await client.callTool("enable_notifications", { project: "nope" });
  assert.equal(unknown.isError, true);
  assert.match(unknown.text, /No analysis belongs to project "nope"\. Existing projects: "demo"\./);

  const enabled = await client.callTool("enable_notifications", { project: "demo" });
  assert.equal(enabled.isError, false, enabled.text);
  assert.match(enabled.text, new RegExp(`command: {5}node ".+index\\.js" --watch ${projectKey("demo")}`));
  assert.match(enabled.text, /timeout_ms: {2}1800000/);
  assert.ok(fs.existsSync(path.join(home.dir, ".mcp-feature-analyzer", "watch", `${projectKey("demo")}.json`)), "the handoff is written in the home folder");
});

test("behind the gateway, enable_notifications returns a watch specification and wait_for_notifications the lines", async () => {
  const spec = await client.request("tools/call", { name: "enable_notifications", arguments: { project: "demo", _gateway_watch: { version: 1 } } });
  const watch = spec._meta["gateway/watch"];
  assert.equal(watch.tool, "wait_for_notifications");
  assert.deepEqual(watch.arguments, { project: "demo" });

  const questionId = askFromGui("Why 60 seconds?");
  const waited = await client.request("tools/call", { name: "wait_for_notifications", arguments: { project: "demo", cursor: watch.cursor, timeout_seconds: 5 } });
  const events = waited._meta["gateway/events"];
  assert.equal(events.lines.length, 1);
  assert.match(events.lines[0], new RegExp(`the reviewer asks you on src/app\\.ts:2: Why 60 seconds\\? — answer with answer_question, analysis_id ${analysisId}, question_id ${questionId}`));
  assert.ok(Number(events.cursor) > Number(watch.cursor));
  assert.ok(liveWatcherSince(temp.dir, "demo"), "the relay's watcher beats on the server side");

  const answered = await client.callTool("answer_question", { analysis_id: analysisId, question_id: questionId, answer: "It matches the token margin." });
  assert.equal(answered.isError, false, answered.text);
  const view = await client.callTool("get_analysis", { analysis_id: analysisId });
  assert.match(view.text, new RegExp(`${questionId} — src/app\\.ts:2 — Why 60 seconds\\? — QUESTION answered at .+: It matches the token margin\\.`));
});

test("the --watch watcher prints one line per event and resumes from its cursor", async (t) => {
  writeHandoff("demo", temp.dir);
  const env = { ...baseEnv(), HOME: home.dir, USERPROFILE: home.dir };
  const watcher = spawn(process.execPath, [SERVER_ENTRY, "--watch", projectKey("demo")], { env, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => watcher.kill());
  let output = "";
  watcher.stdout.setEncoding("utf-8");
  watcher.stdout.on("data", (chunk: string) => (output += chunk));

  const deadline = async (predicate: () => boolean, what: string) => {
    const end = Date.now() + 10000;
    while (!predicate()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}; stdout: ${output}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  await deadline(() => liveWatcherSince(temp.dir, "demo") !== null && listenedProjects(temp.dir).includes("demo"), "the watcher beat");
  const questionId = askFromGui("Is the save idempotent?");
  await deadline(() => output.includes(questionId), "the question line");
  assert.match(output, /\[feature-analyzer\] "Notify" .+ Is the save idempotent\? — answer with answer_question/);
  assert.equal(output.trim().split("\n").length, 1, "only the new question is announced");
});

test("--watch without a handoff fails loudly", async (t) => {
  const empty = makeTempDir("mcp-feature-analyzer-nohome-");
  t.after(empty.cleanup);
  const env = { ...baseEnv(), HOME: empty.dir, USERPROFILE: empty.dir };
  const child = spawn(process.execPath, [SERVER_ENTRY, "--watch", "0123456789abcdef"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (chunk: string) => (stderr += chunk));
  const code = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(code, 1);
  assert.match(stderr, /No notification handoff for project key 0123456789abcdef: call enable_notifications/);
});
