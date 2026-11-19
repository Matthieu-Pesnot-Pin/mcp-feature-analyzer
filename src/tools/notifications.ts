import type { AnalysisStore } from "../core/analysis-store.js";
import type { Analysis } from "../../shared/schemas/analysis.schema.js";
import { AnalysisError } from "../core/errors.js";
import {
  MONITOR_TIMEOUT_MS,
  ReviewEventScanner,
  WATCHER_BEAT_MS,
  advanceCursor,
  formatEvent,
  liveWatcherSince,
  sleep,
  writeHandoff,
  writeWatcherBeat,
} from "../core/notifications.js";
import { answerQuestion as recordAnswer } from "../core/review-actions.js";
import { noteLocationText } from "../../shared/text.js";
import { optionalPositiveInt, rejectUnknownFields, requireString, requireText, textResult, type Args, type MutationResult, type ToolResult } from "./types.js";

/** Argument réservé que le relais de mcp-http-gateway ajoute quand il exécute lui-même le veilleur. */
export const WATCH_ARG = "_gateway_watch";
const WATCH_META = "gateway/watch";
const EVENTS_META = "gateway/events";

export const DEFAULT_NOTIFICATION_WAIT_SECONDS = 50;
export const MAX_NOTIFICATION_WAIT_SECONDS = 300;
const POLL_MS = 1_000;

/** Ce que les outils de notification lisent du serveur. */
export interface NotificationContext {
  store: AnalysisStore;
  dataDir: string;
  /** Commande du veilleur local d'une analyse, à passer à l'outil Monitor. */
  watchCommand: (analysisId: string) => string;
}

/** Analyse existante désignée par `analysis_id`. */
function requireAnalysis(store: AnalysisStore, args: Args): Analysis {
  return store.get(requireString(args, "analysis_id"));
}

function pendingQuestionsNote(scanner: ReviewEventScanner, cursor: number): string[] {
  const pending = scanner.pendingQuestionsUntil(cursor);
  if (pending.length === 0) return [];
  return [
    "",
    `${pending.length} question(s) sent before this watcher are still unanswered; the watcher does not announce them:`,
    ...pending.map(
      (question) =>
        `  ${question.analysisId} / ${question.questionId}${question.location ? ` (${noteLocationText(question.location)})` : ""}: ${question.text.replace(/\s+/g, " ")}`
    ),
    "Answer them with answer_question.",
  ];
}

/**
 * `enable_notifications` : dépose le relais de l'analyse et renvoie l'appel Monitor à
 * faire. Derrière mcp-http-gateway, renvoie la spécification de veille que le relais
 * exécute avec `wait_for_notifications`.
 */
export function enableNotifications(ctx: NotificationContext, args: Args): ToolResult {
  rejectUnknownFields(args, ["analysis_id", WATCH_ARG]);
  const analysis = requireAnalysis(ctx.store, args);
  const description = `feature-analyzer review ${analysis.id}`;
  const scanner = new ReviewEventScanner(ctx.store, analysis.id);

  if (args?.[WATCH_ARG] !== undefined) {
    const cursor = Date.now();
    return {
      content: [{ type: "text", text: ["Watch specification for the mcp-http-gateway relay.", ...pendingQuestionsNote(scanner, cursor)].join("\n") }],
      _meta: {
        [WATCH_META]: {
          tool: "wait_for_notifications",
          arguments: { analysis_id: analysis.id },
          cursor: String(cursor),
          description,
        },
      },
    };
  }

  const cursor = writeHandoff(analysis.id, ctx.dataDir);
  const command = ctx.watchCommand(analysis.id);
  const since = liveWatcherSince(ctx.dataDir, analysis.id);
  if (since) {
    return textResult(
      [
        `Notifications are already live for the review "${analysis.title}" (${analysis.id}) since ${since}: they cover its follow-up reviews too.`,
        "Nothing to do: do not arm a second watcher, you would get every notification twice.",
        "Only if the host just told you your watcher expired or stopped, re-arm it with the same Monitor call:",
        `command \`${command}\`, timeout_ms ${MONITOR_TIMEOUT_MS}.`,
      ].join("\n")
    );
  }
  return textResult(
    [
      `Notifications enabled for the review "${analysis.title}" (${analysis.id}).`,
      "",
      "Last step — call the Monitor tool now, with exactly these arguments:",
      `  command:     ${command}`,
      `  description: ${description}`,
      `  timeout_ms:  ${MONITOR_TIMEOUT_MS}`,
      "",
      "Until that watcher is armed, nothing will reach you. Once it is, keep working: it covers this review and its follow-up",
      "reviews, including the ones created later — and nothing else: the other reviews are left to their own agents.",
      "When the reviewer sends you a question from the GUI, a line gives the review, the location, the question and its",
      "question_id: answer it right away with answer_question; the reviewer reads the answer in the GUI.",
      "When the reviewer submits the review, a line gives the decision: read the feedback with get_review_feedback.",
      "",
      "The host stops every monitor after 30 minutes at most. Each time it tells you this watcher expired, call",
      "Monitor again right away with the same arguments — do not call enable_notifications again. An event that",
      "happened while no watcher was running is announced as soon as the watcher is back.",
      ...pendingQuestionsNote(scanner, cursor),
    ].join("\n")
  );
}

const gatewayBeats = new Map<string, { since: string; at: number }>();

/** Battement du veilleur exécuté par le relais : il n'a pas de processus local qui écrive le sien. */
function beatGatewayWatcher(dataDir: string, analysisId: string): void {
  const last = gatewayBeats.get(analysisId);
  if (last && Date.now() - last.at < WATCHER_BEAT_MS) return;
  const since = last?.since ?? new Date().toISOString();
  writeWatcherBeat(dataDir, analysisId, since);
  gatewayBeats.set(analysisId, { since, at: Date.now() });
}

/**
 * `wait_for_notifications` : attend un événement de l'analyse ou de ses revues de suivi postérieur au curseur, ou
 * l'échéance, et renvoie une ligne par événement avec le curseur suivant. Réservé au
 * veilleur du relais de mcp-http-gateway.
 */
export async function waitForNotifications(ctx: NotificationContext, args: Args, signal?: AbortSignal): Promise<ToolResult> {
  rejectUnknownFields(args, ["analysis_id", "cursor", "timeout_seconds"]);
  const analysisId = requireAnalysis(ctx.store, args).id;
  const rawCursor = args?.cursor;
  if (rawCursor !== undefined && (typeof rawCursor !== "string" || !/^\d+$/.test(rawCursor))) {
    throw new AnalysisError(`"cursor" must be the cursor returned by the previous call, a string of digits (got ${JSON.stringify(rawCursor)}).`);
  }
  const timeout = optionalPositiveInt(args, "timeout_seconds") ?? DEFAULT_NOTIFICATION_WAIT_SECONDS;
  if (timeout > MAX_NOTIFICATION_WAIT_SECONDS) {
    throw new AnalysisError(`"timeout_seconds" must be at most ${MAX_NOTIFICATION_WAIT_SECONDS} (got ${timeout}).`);
  }

  const scanner = new ReviewEventScanner(ctx.store, analysisId);
  let cursor = rawCursor === undefined ? Date.now() : Number(rawCursor);
  const deadline = Date.now() + timeout * 1000;
  for (;;) {
    beatGatewayWatcher(ctx.dataDir, analysisId);
    const events = scanner.since(cursor);
    if (events.length > 0 || Date.now() >= deadline || signal?.aborted) {
      cursor = advanceCursor(cursor, events);
      const lines = events.map(formatEvent);
      return {
        content: [{ type: "text", text: JSON.stringify({ received: lines.length, cursor: String(cursor), lines }) }],
        _meta: { [EVENTS_META]: { cursor: String(cursor), lines } },
      };
    }
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())), signal);
  }
}

/** `answer_question` : enregistre la réponse de l'agent à une question du relecteur. */
export function answerQuestion(store: AnalysisStore, args: Args): MutationResult {
  rejectUnknownFields(args, ["analysis_id", "question_id", "answer"]);
  const id = requireString(args, "analysis_id");
  const questionId = requireString(args, "question_id");
  const answer = requireText(args, "answer").trim();
  const updated = recordAnswer(store, id, questionId, answer);
  return {
    result: textResult(`Answered question ${questionId} of "${updated.title}" (${updated.id}): the reviewer reads the answer in the GUI.`),
    analysisId: updated.id,
  };
}
