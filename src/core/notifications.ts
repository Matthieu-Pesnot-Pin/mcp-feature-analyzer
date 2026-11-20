import fs from "fs";
import os from "os";
import path from "path";
import type { Analysis, NoteLocation, ReviewDecision } from "../../shared/schemas/analysis.schema.js";
import { questionExchanges } from "../../shared/question-thread.js";
import { noteLocationText } from "../../shared/text.js";
import { AnalysisStore, writeJsonAtomic } from "./analysis-store.js";
import { AnalysisError } from "./errors.js";

/** Durée maximale d'un Monitor côté hôte. */
export const MONITOR_TIMEOUT_MS = 1_800_000;

const SCAN_INTERVAL_MS = 1_000;
export const WATCHER_BEAT_MS = 5_000;
const WATCHER_STALE_MS = 15_000;
const HANDOFF_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const BACKOFF_MAX_MS = 30_000;

// --- Événements à annoncer -----------------------------------------------------------

/** Échange précédent d'une relance : la question d'origine et la dernière réponse de l'agent. */
export interface FollowUpContext {
  question: string;
  lastAnswer: string;
}

/**
 * Dernier message du relecteur sur une question, pas encore répondu : la question
 * elle-même, ou une relance après une réponse de l'agent (`followUp`).
 */
export interface QuestionAsked {
  kind: "question";
  analysisId: string;
  title: string;
  questionId: string;
  location: NoteLocation | null;
  text: string;
  followUp: FollowUpContext | null;
  /** Instant où ce message a été envoyé. */
  eventMs: number;
}

/** Revue soumise par le relecteur. */
export interface ReviewSubmitted {
  kind: "submitted";
  analysisId: string;
  title: string;
  decision: ReviewDecision;
  findingCount: number;
  noteCount: number;
  /** Instant de la soumission. */
  eventMs: number;
}

export type ReviewEvent = QuestionAsked | ReviewSubmitted;

function eventsOf(analysis: Analysis): ReviewEvent[] {
  const events: ReviewEvent[] = [];
  for (const note of analysis.notes) {
    if (note.question === null) continue;
    const exchanges = questionExchanges({ ...note, question: note.question });
    const last = exchanges[exchanges.length - 1];
    if (last.answer !== null) continue;
    const previous = exchanges[exchanges.length - 2];
    events.push({
      kind: "question",
      analysisId: analysis.id,
      title: analysis.title,
      questionId: note.id,
      location: note.location,
      text: last.text,
      followUp: previous?.answer ? { question: note.text, lastAnswer: previous.answer.text } : null,
      eventMs: Date.parse(last.askedAt),
    });
  }
  const review = analysis.review;
  if (review.state === "submitted" && review.decision !== null && review.submittedAt !== null) {
    events.push({
      kind: "submitted",
      analysisId: analysis.id,
      title: analysis.title,
      decision: review.decision,
      findingCount: review.selectedFindingIds.length,
      noteCount: review.selectedNoteIds.length,
      eventMs: Date.parse(review.submittedAt),
    });
  }
  return events;
}

/** Vrai si `id` est `root` ou l'une de ses revues de suivi, d'après les liens `followUpOf`. */
function inChain(id: string, root: string, followUpOf: ReadonlyMap<string, string>): boolean {
  const seen = new Set<string>();
  let current: string | undefined = id;
  while (current !== undefined && !seen.has(current)) {
    if (current === root) return true;
    seen.add(current);
    current = followUpOf.get(current);
  }
  return false;
}

/**
 * Lit les événements à annoncer pour une analyse et ses revues de suivi, y
 * compris celles créées après le lancement : questions du relecteur sans réponse
 * et revues soumises. Le curseur est l'instant, en millisecondes, du dernier
 * événement déjà annoncé. Une analyse illisible est ignorée ; le store ne relit
 * que les fichiers modifiés.
 */
export class ReviewEventScanner {
  constructor(
    private readonly store: AnalysisStore,
    private readonly analysisId: string
  ) {}

  /** Événements postérieurs à `cursor`, dans l'ordre chronologique. */
  since(cursor: number): ReviewEvent[] {
    const analyses: Analysis[] = [];
    const followUpOf = new Map<string, string>();
    for (const id of this.store.ids()) {
      try {
        const analysis = this.store.get(id);
        analyses.push(analysis);
        if (analysis.followUpOf !== null) followUpOf.set(analysis.id, analysis.followUpOf);
      } catch {
        continue;
      }
    }
    const found: ReviewEvent[] = [];
    for (const analysis of analyses) {
      if (!inChain(analysis.id, this.analysisId, followUpOf)) continue;
      for (const event of eventsOf(analysis)) if (event.eventMs > cursor) found.push(event);
    }
    return found.sort((a, b) => a.eventMs - b.eventMs || orderKey(a).localeCompare(orderKey(b)));
  }

  /** Questions sans réponse envoyées jusqu'à `cursor` inclus. */
  pendingQuestionsUntil(cursor: number): QuestionAsked[] {
    return this.since(0).filter((event): event is QuestionAsked => event.kind === "question" && event.eventMs <= cursor);
  }
}

function orderKey(event: ReviewEvent): string {
  return event.kind === "question" ? `${event.analysisId}/${event.questionId}` : event.analysisId;
}

/** Curseur après annonce des événements donnés. */
export function advanceCursor(cursor: number, announced: ReviewEvent[]): number {
  return announced.reduce((max, event) => Math.max(max, event.eventMs), cursor);
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const DECISION_TEXT: Record<ReviewDecision, string> = {
  approve: "approved the feature — nothing to process",
  request_changes: "requests changes",
  reject: "rejected the feature",
};

/** Ligne de notification : une seule ligne, lisible telle quelle par l'agent. */
export function formatEvent(event: ReviewEvent): string {
  const origin = `[feature-analyzer] "${oneLine(event.title, 80)}" (${event.analysisId})`;
  if (event.kind === "question") {
    const where = event.location ? ` on ${noteLocationText(event.location)}` : "";
    const answerWith = `answer with answer_question, analysis_id ${event.analysisId}, question_id ${event.questionId}`;
    if (event.followUp) {
      return (
        `${origin} — the reviewer follows up on question ${event.questionId}${where} ` +
        `(question: "${oneLine(event.followUp.question, 300)}"; your last answer: "${oneLine(event.followUp.lastAnswer, 300)}"): ` +
        `${oneLine(event.text, 1000)} — ${answerWith}`
      );
    }
    return `${origin} — the reviewer asks you${where}: ${oneLine(event.text, 1000)} — ${answerWith}`;
  }
  return (
    `${origin} — the reviewer submitted the review and ${DECISION_TEXT[event.decision]} ` +
    `(${event.findingCount} finding(s) and ${event.noteCount} note(s) selected) — ` +
    `read it with get_review_feedback, analysis_id ${event.analysisId}`
  );
}

// --- Veilleur local ----------------------------------------------------------------
//
// Le veilleur est lancé par l'outil Monitor de l'hôte, dans le shell de la session : il
// n'hérite pas du bloc `env` du MCP. Le relais lui indique le dossier de données et
// garde le curseur, pour qu'un veilleur relancé reprenne là où le précédent s'est
// arrêté. Il ne contient aucun secret. L'identifiant d'analyse, un slug, sert de nom
// de fichier et d'argument de la commande.

interface Handoff {
  analysisId: string;
  dataDir: string;
  cursor: number;
  written_at: string;
}

function handoffDir(): string {
  return path.join(os.homedir(), ".mcp-feature-analyzer", "watch");
}

function handoffPath(analysisId: string): string {
  return path.join(handoffDir(), `${analysisId}.json`);
}

const written = new Set<string>();

function readHandoff(analysisId: string): Handoff | null {
  try {
    const handoff = JSON.parse(fs.readFileSync(handoffPath(analysisId), "utf-8")) as Handoff;
    return handoff.analysisId === analysisId ? handoff : null;
  } catch {
    return null;
  }
}

function saveHandoff(handoff: Omit<Handoff, "written_at">): void {
  fs.mkdirSync(handoffDir(), { recursive: true });
  writeJsonAtomic(handoffPath(handoff.analysisId), { ...handoff, written_at: new Date().toISOString() } satisfies Handoff);
}

/** Dépose le relais de l'analyse et renvoie son curseur ; un relais existant garde le sien. */
export function writeHandoff(analysisId: string, dataDir: string): number {
  written.add(analysisId);
  const existing = readHandoff(analysisId);
  const cursor = existing?.cursor ?? Date.now();
  saveHandoff({ analysisId, dataDir, cursor });
  pruneStaleHandoffs();
  return cursor;
}

/** Retire les relais écrits par ce processus. Synchrone : appelable sur `exit`. */
export function removeOwnHandoffs(): void {
  for (const analysisId of written) fs.rmSync(handoffPath(analysisId), { force: true });
  written.clear();
}

function pruneStaleHandoffs(): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(handoffDir());
  } catch {
    return;
  }
  for (const entry of entries) {
    const file = path.join(handoffDir(), entry);
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > HANDOFF_STALE_MS) fs.rmSync(file, { force: true });
    } catch {
      // Un relais déjà supprimé ne doit pas faire échouer l'écriture.
    }
  }
}

// --- Battement des veilleurs -----------------------------------------------------------

interface WatcherBeat {
  analysisId: string;
  since: string;
  updatedAt: number;
}

function watchersDir(dataDir: string): string {
  return path.join(dataDir, "watchers");
}

/** Signale qu'un veilleur suit l'analyse (et ses revues de suivi) depuis `since`. */
export function writeWatcherBeat(dataDir: string, analysisId: string, since: string): void {
  fs.mkdirSync(watchersDir(dataDir), { recursive: true });
  writeJsonAtomic(path.join(watchersDir(dataDir), `${analysisId}.json`), { analysisId, since, updatedAt: Date.now() } satisfies WatcherBeat);
}

function readBeat(file: string): WatcherBeat | null {
  try {
    const beat = JSON.parse(fs.readFileSync(file, "utf-8")) as WatcherBeat;
    return Date.now() - beat.updatedAt < WATCHER_STALE_MS ? beat : null;
  } catch {
    return null;
  }
}

/** Date depuis laquelle un veilleur vivant suit cette analyse, ou null. */
export function liveWatcherSince(dataDir: string, analysisId: string): string | null {
  const beat = readBeat(path.join(watchersDir(dataDir), `${analysisId}.json`));
  return beat?.analysisId === analysisId ? beat.since : null;
}

/** Analyses suivies par un veilleur vivant ; chacune couvre aussi ses revues de suivi. */
export function watchedAnalyses(dataDir: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(watchersDir(dataDir));
  } catch {
    return [];
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const beat = readBeat(path.join(watchersDir(dataDir), entry));
    if (beat) ids.push(beat.analysisId);
  }
  return ids;
}

/**
 * Mode veilleur local (`--watch <analysis_id>`). Une ligne sur stdout par
 * événement de l'analyse ou de ses revues de suivi, y compris celles créées après
 * le lancement du veilleur : l'outil Monitor de l'hôte réveille l'agent à chaque
 * ligne. Le journal et les erreurs partent sur stderr. Une erreur de lecture se
 * traduit par un réessai.
 */
export async function runWatchMode(analysisId: string | null): Promise<void> {
  if (!analysisId) throw new AnalysisError("--watch needs an analysis id: call enable_notifications to get the exact command.");
  const handoff = readHandoff(analysisId);
  if (!handoff) {
    throw new AnalysisError(`No notification handoff for analysis ${analysisId}: call enable_notifications in that MCP session first.`);
  }

  const scanner = new ReviewEventScanner(new AnalysisStore(handoff.dataDir), analysisId);
  const since = new Date().toISOString();
  let cursor = handoff.cursor;
  let lastBeat = 0;
  let backoff = SCAN_INTERVAL_MS;
  process.stderr.write(`[feature-analyzer] watching analysis ${analysisId} and its follow-up reviews in ${handoff.dataDir}\n`);

  for (;;) {
    try {
      if (Date.now() - lastBeat >= WATCHER_BEAT_MS) {
        writeWatcherBeat(handoff.dataDir, analysisId, since);
        lastBeat = Date.now();
      }
      const events = scanner.since(cursor);
      if (events.length > 0) {
        for (const event of events) process.stdout.write(`${formatEvent(event)}\n`);
        cursor = advanceCursor(cursor, events);
        saveHandoff({ analysisId, dataDir: handoff.dataDir, cursor });
      }
      backoff = SCAN_INTERVAL_MS;
      await sleep(SCAN_INTERVAL_MS);
    } catch (err: any) {
      process.stderr.write(`[feature-analyzer] scan failed, retrying in ${Math.round(backoff / 1000)} s: ${err?.message ?? err}\n`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    }
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}
