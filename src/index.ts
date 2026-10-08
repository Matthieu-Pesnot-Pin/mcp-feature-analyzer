#!/usr/bin/env node
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { GuiLauncher, createLogger, reconnectGuiToolDefinition, setupLogging } from "@imenam/mcp-gui-interface";

import { APP_VERSION } from "./version.js";
import { resolveDataDir } from "./core/data-dir.js";
import { resolveLogDir } from "./core/log-dir.js";
import { AnalysisStore } from "./core/analysis-store.js";
import { AnalysisError, NotFoundError, RevisionConflictError } from "./core/errors.js";
import { DEFAULT_HEAD_REF, localRepo, type RepoAccess } from "./core/git.js";
import { agentRepo } from "./core/agent-repo.js";
import { EXEC_ARG, handleAgentExec } from "./core/gateway-exec.js";
import { resolveRole, type Role } from "./core/role.js";
import { addNote, deleteNote, setFileReviewed, setFindingStatus, submitReview, updateNote } from "./core/review-actions.js";
import { GUI_REQUEST_TYPES, IPCMessageSchema, type IPCMessage, type IpcErrorKind } from "../shared/schemas/ipc.schema.js";
import {
  AddNoteRequestSchema,
  AnalysisRequestSchema,
  DeleteNoteRequestSchema,
  SetFileReviewedRequestSchema,
  SetFindingStatusRequestSchema,
  SubmitReviewRequestSchema,
  UpdateNoteRequestSchema,
} from "../shared/schemas/api.schema.js";
import type { z } from "zod";
import {
  ANALYSIS_MODES,
  DIAGRAM_KINDS,
  EXPLANATION_SIDES,
  FINDING_KINDS,
  NODE_SHAPES,
  NODE_STATUSES,
  SEVERITIES,
} from "../shared/schemas/analysis.schema.js";
import { errorResult, textResult, type MutationResult, type ToolResult } from "./tools/types.js";
import { createAnalysis } from "./tools/create-analysis.js";
import { listAnalyses } from "./tools/list-analyses.js";
import { getAnalysis } from "./tools/get-analysis.js";
import { getDiff } from "./tools/get-diff.js";
import { refreshAnalysis } from "./tools/refresh-analysis.js";
import { updateAnalysis } from "./tools/update-analysis.js";
import { addFindings } from "./tools/add-findings.js";
import { updateFinding } from "./tools/update-finding.js";
import { deleteFindings } from "./tools/delete-findings.js";
import { addExplanations } from "./tools/add-explanations.js";
import { updateExplanation } from "./tools/update-explanation.js";
import { deleteExplanations } from "./tools/delete-explanations.js";
import { DEFAULT_NODE_SHAPE, DEFAULT_NODE_STATUS, setDiagram } from "./tools/set-diagram.js";
import { deleteDiagram } from "./tools/delete-diagram.js";
import { getReviewFeedback } from "./tools/get-review-feedback.js";
import { deleteAnalysis } from "./tools/delete-analysis.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Les flags CLI sont traités avant toute initialisation : ils s'exécutent dans le
// répertoire de l'utilisateur, pas dans un serveur MCP.
if (process.argv.slice(2).includes("--claude-setup-mcp")) {
  const argv = process.argv.slice(2);
  const { runSetupMcp, parseGuiExposure } = await import("./cli/setup-mcp.js");
  const parsed = parseGuiExposure(argv);
  if ("error" in parsed) {
    console.error(`Erreur : ${parsed.error}`);
    process.exit(1);
  }
  process.exit(runSetupMcp({ cwd: process.cwd(), force: argv.includes("--force"), exposure: parsed.exposure }));
}

function findProjectRoot(startDir: string): string {
  let current = startDir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "package.json"))) return current;
    current = path.dirname(current);
  }
  return startDir;
}

const rootDir = findProjectRoot(__dirname);
const packageEnvPath = path.join(rootDir, ".env");

setupLogging({ processLabel: "mcp-feature-analyzer", logDir: resolveLogDir(rootDir) });
const logger = createLogger("mcp-feature-analyzer");

// Rechargé à chaque appel, avec override : le .env local prime sur les
// variables héritées de la déclaration du MCP.
function getConfig() {
  if (fs.existsSync(packageEnvPath)) dotenv.config({ path: packageEnvPath, override: true, quiet: true });
  return { proxyUrl: process.env.PROXY_URL, appPort: process.env.APP_PORT, version: APP_VERSION };
}

getConfig();

let role: Role;
try {
  role = resolveRole();
} catch (err: any) {
  logger.error(err.message);
  console.error(err.message);
  process.exit(1);
}

const dataDir = resolveDataDir(rootDir);
const store = new AnalysisStore(dataDir);

/** Présentation du serveur transmise au client MCP : concepts, déroulé et règles. */
const INSTRUCTIONS = `mcp-feature-analyzer helps a human review a feature you developed. You write the analysis through these tools; the user reviews it in a web GUI and records feedback that you read back.

Concepts:
- An **analysis** is one feature under review. It freezes the git diff of a repository (branch mode: base...head; working_tree mode: uncommitted changes, index included, against HEAD) together with your overview, summary, findings and diagrams.
- A **project** groups the analyses of one product or feature; the GUI files analyses by project.
- The **overview** is your global analysis of the feature: its objective (what it lets users do), its approach (architecture choices, main flow) and the attention points the reviewer should check first. The **summary** lists the functional changes of the feature, one bullet per change, not one bullet per file.
- A **finding** is a point for the reviewer: an issue anchored on changed lines, or a requirement_gap for requested behaviour that is missing (location optional). Severity: ${SEVERITIES.join(", ")}.
- An **explanation** describes what a block of added or removed code does and how it works, so that the reviewer understands it before judging it. It is not a finding: it judges nothing and asks for nothing. It is anchored on new-side lines (added code) or old-side lines (removed code), and shown in the diff above the lines it describes.
- A **diagram** is a flow, layers or mindmap picture of the feature. You give nodes and links only; the GUI lays them out.
- The **review** belongs to the reviewer: files marked reviewed, findings ignored, notes, and a submitted decision with a prompt for you.

Workflow:
1. list_analyses (with project) to find an analysis of the same feature: reuse it with update_analysis and refresh_analysis instead of creating a duplicate. Otherwise create_analysis with its project once the feature is developed.
2. get_diff to read the frozen diff.
3. update_analysis with the overview (objective, approach, attention_points) and the summary (the functional changes).
4. add_explanations for the long or complex blocks of added or removed code (see Explanation rules).
5. add_findings for every problem, including requirement_gap findings for requested behaviour that is missing.
6. set_diagram when a picture helps (impacted layers, process flow, concept tree).
7. Tell the user to review the analysis in the GUI (the link is in the tool results).
8. get_review_feedback to read the decision, the selected points and the prompt.
9. Fix the code, then refresh_analysis to recompute the diff for a new review round; re-anchor or rewrite the outdated findings and explanations.

Explanation rules:
- Write one for every added or removed block that is long (a function or a block of about 30 lines or more) or complex (non-trivial algorithm, state machine, concurrency, recursion, tricky regular expression or data transformation). A 100-line function always gets one.
- Cover the whole block, from its first to its last line. Title: the name of the block and its role, e.g. "parseUnifiedDiff: diff text to hunks".
- Body: what the block does (inputs, outputs, effects), then how it works, step by step, in the order of the code; name the key variables and the edge cases it handles. For removed code, say what it did and what replaces it, if anything.
- Describe, never judge: problems go in findings.
- Skip trivial code (imports, getters, simple wiring): an explanation there only adds noise.

Diagram rules:
- One subject per diagram, 5 to 12 nodes; split a bigger picture into several diagrams.
- Declare nodes in reading order (from the start of the flow, from top to bottom): the declaration order is the initial order of every rank or column.
- Zero crossings are expected. set_diagram reports link crossings and links through nodes; fix them before moving on.
- flow for a process with steps and decisions; layers for the impact perimeter across architecture layers; mindmap for a tree of concepts (one root, one parent per node).

Rules:
- Line numbers are NEW-side numbers, as shown by get_diff, except for explanations of removed code, which use OLD-side numbers (side "old").
- Nothing is ever written to the repository: suggestions are displayed to the reviewer only.
- The reviewer alone decides which findings are ignored and when the review is submitted; you cannot change either.`;

const server = new Server(
  { name: "mcp-feature-analyzer", version: APP_VERSION },
  { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
);

// --- Cycle de vie de la GUI -------------------------------------------------

/** Envoie un message IPC au GUI worker s'il est connecté. */
function broadcastToGUI(message: IPCMessage) {
  const child = guiLauncher.getProcess();
  if (child?.connected) {
    try {
      child.send(message);
    } catch (err: any) {
      logger.error(`Failed to send IPC message: ${err.message}`);
    }
  }
}

function reply(msg: IPCMessage, type: string, data: unknown) {
  broadcastToGUI({ type, correlationId: msg.correlationId, data, timestamp: new Date().toISOString() });
}

function replyError(msg: IPCMessage, type: string, error: string, errorKind: IpcErrorKind) {
  broadcastToGUI({ type, correlationId: msg.correlationId, error, errorKind, timestamp: new Date().toISOString() });
}

/** Notifie la GUI qu'une analyse a changé côté agent, pour qu'elle se rafraîchisse. */
function notifyAnalysisChanged(analysisId: string) {
  broadcastToGUI({ type: "ANALYSIS_UPDATED", data: { analysisId }, timestamp: new Date().toISOString() });
}

/** Envoie à la GUI la liste des analyses, après une création ou une suppression. */
function notifyAnalysesListChanged() {
  broadcastToGUI({ type: "ANALYSES_UPDATED", data: { analyses: store.list().analyses }, timestamp: new Date().toISOString() });
}

/** Données IPC d'une requête de la GUI, validées par `schema` ; une donnée invalide est une erreur de la requête. */
function parseRequest<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"} ${issue.message}`);
    throw new AnalysisError(`Invalid request: ${issues.join("; ")}.`);
  }
  return parsed.data;
}

/** Nature d'une erreur levée en traitant une requête de la GUI. */
function errorKindOf(err: unknown): IpcErrorKind {
  if (err instanceof RevisionConflictError) return "conflict";
  if (err instanceof NotFoundError) return "not_found";
  if (err instanceof AnalysisError) return "invalid";
  return "internal";
}

/** Modification faite depuis la GUI : la liste des analyses et l'analyse sont renvoyées à tous les clients. */
function afterUserMutation(analysisId: string) {
  notifyAnalysisChanged(analysisId);
  notifyAnalysesListChanged();
}

/** Traite une requête de la GUI et renvoie ses données de réponse ; lève une erreur métier sinon. */
function handleGuiRequest(msg: IPCMessage): unknown {
  switch (msg.type) {
    case "GET_CONFIG":
      return { dataDir, version: APP_VERSION };

    case "LIST_ANALYSES":
      return store.list();

    case "GET_ANALYSIS":
      return { analysis: store.get(parseRequest(AnalysisRequestSchema, msg.data).analysisId) };

    case "GET_DIFF":
      return { diff: store.getSnapshot(parseRequest(AnalysisRequestSchema, msg.data).analysisId) };

    case "SET_FILE_REVIEWED": {
      const request = parseRequest(SetFileReviewedRequestSchema, msg.data);
      const analysis = setFileReviewed(store, request.analysisId, request.body);
      afterUserMutation(analysis.id);
      return { analysis };
    }

    case "SET_FINDING_STATUS": {
      const request = parseRequest(SetFindingStatusRequestSchema, msg.data);
      const analysis = setFindingStatus(store, request.analysisId, request.findingId, request.body);
      afterUserMutation(analysis.id);
      return { analysis };
    }

    case "ADD_NOTE": {
      const request = parseRequest(AddNoteRequestSchema, msg.data);
      const analysis = addNote(store, request.analysisId, request.body);
      afterUserMutation(analysis.id);
      return { analysis };
    }

    case "UPDATE_NOTE": {
      const request = parseRequest(UpdateNoteRequestSchema, msg.data);
      const analysis = updateNote(store, request.analysisId, request.noteId, request.body);
      afterUserMutation(analysis.id);
      return { analysis };
    }

    case "DELETE_NOTE": {
      const request = parseRequest(DeleteNoteRequestSchema, msg.data);
      const analysis = deleteNote(store, request.analysisId, request.noteId, request.body);
      afterUserMutation(analysis.id);
      return { analysis };
    }

    case "SUBMIT_REVIEW": {
      const request = parseRequest(SubmitReviewRequestSchema, msg.data);
      const analysis = submitReview(store, request.analysisId, request.body);
      afterUserMutation(analysis.id);
      return { analysis };
    }

    default:
      throw new Error(`GUI request ${msg.type} has no handler.`);
  }
}

const GUI_REQUESTS = new Set<string>(GUI_REQUEST_TYPES);

/**
 * Messages du GUI worker. READY et ALREADY_RUNNING sont d'abord traités par
 * GuiLauncher (statut, URL), puis transmis ici.
 */
function handleIPCMessage(raw: unknown) {
  const parsed = IPCMessageSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn(`Invalid IPC message ignored: ${parsed.error.message}`);
    return;
  }
  const msg = parsed.data;

  switch (msg.type) {
    case "READY":
      logger.info(`GUI ready at ${msg.data?.url}`);
      return;

    case "ALREADY_RUNNING":
      logger.info(`GUI already served by another instance at ${msg.data?.url}`);
      return;

    case "GET_INITIAL_STATE":
      broadcastToGUI({
        type: "INITIAL_STATE",
        data: { version: APP_VERSION, analyses: store.list().analyses },
        timestamp: new Date().toISOString(),
      });
      return;

    default:
      if (GUI_REQUESTS.has(msg.type)) {
        try {
          reply(msg, `${msg.type}_RESPONSE`, handleGuiRequest(msg));
        } catch (err: any) {
          const kind = errorKindOf(err);
          if (kind === "internal") logger.error(`GUI request ${msg.type} failed: ${err?.stack ?? err}`);
          replyError(msg, `${msg.type}_RESPONSE`, err?.message ?? String(err), kind);
        }
        return;
      }
      logger.debug(`Unhandled IPC message type: ${msg.type}`);
  }
}

const guiLauncher = new GuiLauncher({
  guiPath: path.join(__dirname, "gui-worker.js"),
  maxRestarts: 0,
  onMessage: handleIPCMessage,
  reloadEnv: getConfig,
});

/** La GUI a besoin soit d'un proxy, soit d'un port local (mode standalone). */
function guiIsConfigured(): boolean {
  return !!(process.env.PROXY_URL?.trim() || process.env.APP_PORT?.trim());
}

function launchGUI() {
  if (!guiIsConfigured()) {
    logger.info("[MASTER] Ni PROXY_URL ni APP_PORT défini — GUI désactivée.");
    return;
  }
  logger.info("Launching GUI worker...");
  guiLauncher.start();
}

/**
 * `reconnect_gui` : relance via GuiLauncher en mode proxy. En mode standalone,
 * GuiLauncher ne sait pas relancer le worker : l'outil décrit l'état et la
 * marche à suivre.
 */
async function reconnectGui(args: Record<string, unknown>): Promise<ToolResult> {
  getConfig();
  const appPort = process.env.APP_PORT?.trim();
  if (process.env.PROXY_URL?.trim() || !appPort) {
    return { ...(await guiLauncher.handleReconnectTool({ force: args.force === true })) };
  }

  const child = guiLauncher.getProcess();
  const alive = !!child && child.exitCode === null && !child.killed;
  const url = guiLauncher.getUrl();
  if (alive && guiLauncher.getStatus() === "ready") {
    return textResult(`GUI is served in standalone mode at ${url}. Nothing to do.`);
  }
  return errorResult(
    `reconnect_gui relaunches the GUI through the proxy only. The GUI is in standalone mode (APP_PORT=${appPort}) and is not running (status: ${guiLauncher.getStatus()}). Free port ${appPort} or set another APP_PORT, then restart the MCP server. To use the proxy instead, set PROXY_URL and call reconnect_gui again.`
  );
}

// --- Déclaration des outils -------------------------------------------------

/** Lien vers l'analyse dans la GUI, ajouté aux résultats de mutation ; vide quand la GUI est désactivée. */
function guiHint(analysisId: string): string {
  const url = guiLauncher.getUrl();
  if (!url) return "";
  return `\n\nOpen the review: ${url}#/${encodeURIComponent(analysisId)}`;
}

const ANALYSIS_ID_DOC = "Id of the analysis, as returned by create_analysis or list_analyses.";

const LINE_NUMBERS_DOC = "Line numbers are NEW-side numbers, as shown in the second column of get_diff.";

const LOCATION_PROPERTIES = {
  path: {
    type: "string",
    description: "Path of a changed file of the analysis, relative to the repository root, as listed by get_diff.",
  },
  start_line: { type: "integer", minimum: 1, description: `First targeted line. ${LINE_NUMBERS_DOC}` },
  end_line: { type: "integer", minimum: 1, description: "Last targeted line, inclusive (default: start_line)." },
} as const;

const EXPLANATION_LOCATION_PROPERTIES = {
  path: LOCATION_PROPERTIES.path,
  side: {
    type: "string",
    enum: [...EXPLANATION_SIDES],
    description:
      'Side of the diff the lines belong to (default "new"): "new" for added or kept code, with NEW-side numbers (second column of get_diff); ' +
      '"old" for removed code, with OLD-side numbers (first column of get_diff), all shown in the diff and at least one removed.',
  },
  start_line: { type: "integer", minimum: 1, description: "First described line, on the side given by side." },
  end_line: { type: "integer", minimum: 1, description: "Last described line, inclusive (default: start_line)." },
} as const;

const EXPLANATION_BODY_DOC =
  "What the code does (inputs, outputs, effects), then how it works, step by step in the order of the code. Describe, never judge. Plain text; line breaks are kept.";

const SEVERITY_DOC = `Severity: ${SEVERITIES.join(", ")} (from most to least serious).`;

const FINDING_KIND_DOC =
  `Kind (default "issue"): "issue" is a problem in the changed code and needs a location; ` +
  `"requirement_gap" is requested behaviour that is missing and may have no location.`;

const SUGGESTION_DOC =
  "Replacement text proposed for the targeted lines, kept verbatim (indentation included); an empty string proposes deleting them. " +
  "Displayed to the reviewer only: nothing is written to the repository. Needs a location.";

const FINDING_PROMPT_DOC =
  "Prompt to hand back to the agent for this finding, replacing the generated one (body, current lines, replacement) in the review feedback.";

const REQUEST_TEXT_DOC = "Initial request the feature answers (ticket, user prompt), shown to the reviewer.";
const REQUEST_SOURCE_DOC = "Where the initial request comes from, e.g. a ticket id or URL.";

const NODE_STATUS_DOC =
  `Status (default "${DEFAULT_NODE_STATUS}"): new = added by the feature; modified = changed by the feature; ` +
  `impacted = unchanged code whose behaviour the feature affects; existing = unchanged context; ` +
  `finding = where a finding sits; missing = requested but not implemented (drawn as an outline).`;

const NODE_SHAPE_DOC =
  `Shape (default "${DEFAULT_NODE_SHAPE}"): box = component or step; pill = start, end or actor; decision = a branch in a flow (drawn as a diamond).`;

const DIAGRAM_KIND_DOC =
  "flow = a process with steps and decisions, laid out left to right along the links, where a side branch without a join and the last node of a chain hang below the node before them; " +
  "layers = the impact perimeter, one column per entry of `layers` (e.g. GUI, API, core, storage), each node in its layer; " +
  "mindmap = a tree of concepts drawn radially around its root: exactly one root, one incoming link for every other node, no cycle (refused otherwise).";

const DIAGRAM_RULES_DOC =
  "Rules: one subject per diagram, 5 to 12 nodes; declare nodes in reading order, since the declaration order is the initial order of every rank or column; " +
  "zero crossings expected. The result reports every link crossing and every link through a node, with advice: reorder the nodes, split the diagram or change its kind, then send it again.";

const PROJECT_DOC =
  "Project the analysis belongs to: the product or feature name, used as its folder in the GUI. " +
  "Reuse the exact name of an existing project (see list_analyses) for another analysis of it.";

const TOOLS = [
  {
    name: "list_analyses",
    description:
      "List the analyses grouped by project, with their refs, open findings by severity, reviewed files, diagram count and review state " +
      "(not started, in progress, all files reviewed, submitted). Start here: when the project already has an analysis of the feature, " +
      "continue it (update_analysis to rewrite the overview and summary, refresh_analysis after changing the code) instead of creating a duplicate; " +
      "create a new one with create_analysis for another feature or another diff.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project: { type: "string", description: "Only list the analyses of this project (exact name). An unknown name lists the existing projects." },
      },
    },
  },
  {
    name: "create_analysis",
    description:
      "Create an analysis once a feature is developed: computes and freezes the git diff of the repository for human review. " +
      `In branch mode the diff is base...head (head defaults to ${DEFAULT_HEAD_REF}); in working_tree mode it is the uncommitted changes, index included, against HEAD. ` +
      "Returns the id and the changed files; then read them with get_diff.",
    inputSchema: {
      type: "object" as const,
      properties: {
        repo_path: {
          type: "string",
          description:
            role === "remote"
              ? "Absolute path of the root of the git repository on your machine: git runs there, through the agent relay of mcp-http-gateway."
              : "Absolute path of the root of the git repository.",
        },
        project: { type: "string", description: PROJECT_DOC },
        title: { type: "string", description: "Short title of the feature, e.g. \"OAuth token refresh\"." },
        mode: {
          type: "string",
          enum: [...ANALYSIS_MODES],
          description: "branch: diff between two refs; working_tree: uncommitted changes against HEAD.",
        },
        base: {
          type: "string",
          description: "Branch mode only, required: the ref the feature branched from, e.g. \"master\". Not accepted in working_tree mode.",
        },
        head: {
          type: "string",
          description: `Branch mode only: the ref holding the feature (default ${DEFAULT_HEAD_REF}). Not accepted in working_tree mode.`,
        },
        request_text: { type: "string", description: REQUEST_TEXT_DOC },
        request_source: { type: "string", description: `${REQUEST_SOURCE_DOC} Needs request_text.` },
      },
      required: ["repo_path", "project", "title", "mode"],
    },
  },
  {
    name: "get_analysis",
    description:
      "Read a whole analysis: project, request, overview, summary, files (reviewed or not), findings with their status and location, reviewer notes, " +
      "diagrams (flagged when their layout has crossings) and review state. Use it to check what is already recorded before adding more.",
    inputSchema: {
      type: "object" as const,
      properties: { analysis_id: { type: "string", description: ANALYSIS_ID_DOC } },
      required: ["analysis_id"],
    },
  },
  {
    name: "get_diff",
    description:
      "Read the frozen diff of one file, or of every file when path is omitted, with the old and the new line number of each line. " +
      "Use the NEW-side numbers (second column) for every finding location and diagram node line.",
    inputSchema: {
      type: "object" as const,
      properties: {
        analysis_id: { type: "string", description: ANALYSIS_ID_DOC },
        path: { type: "string", description: "Changed file to show (default: all files)." },
      },
      required: ["analysis_id"],
    },
  },
  {
    name: "update_analysis",
    description:
      "Change the title, the project, the overview, the summary or the initial request of an analysis. Right after reading the diff, " +
      "write the overview (objective, approach, attention_points: your global analysis of the feature) and the summary " +
      "(the functional changes of the feature, one bullet per change, not one bullet per file). Give at least one field; fields left out are kept.",
    inputSchema: {
      type: "object" as const,
      properties: {
        analysis_id: { type: "string", description: ANALYSIS_ID_DOC },
        title: { type: "string", description: "New title." },
        project: { type: "string", description: `New project. ${PROJECT_DOC}` },
        objective: {
          type: ["string", "null"],
          description:
            "Overview: what the feature lets users do, from a functional point of view. When the analysis has no overview yet, give objective and approach together to create it. " +
            "null removes the whole overview (approach and attention points included).",
        },
        approach: {
          type: "string",
          description: "Overview: how the feature achieves it (architecture choices, main flow). Replaces the current approach.",
        },
        attention_points: {
          type: "array",
          items: { type: "string" },
          description:
            "Overview: risks and points the reviewer should check first, one per string. Replaces the whole list; [] clears it. " +
            "Defaults to an empty list when the overview is created without it.",
        },
        summary: {
          type: "array",
          items: { type: "string" },
          description:
            "Functional changes of the feature, one bullet per change (e.g. \"Expired tokens are refreshed once before the request fails\"), not one bullet per file. " +
            "Replaces the whole list; [] clears it.",
        },
        request_text: { type: ["string", "null"], description: `${REQUEST_TEXT_DOC} null removes the request.` },
        request_source: { type: ["string", "null"], description: `${REQUEST_SOURCE_DOC} null clears it.` },
      },
      required: ["analysis_id"],
    },
  },
  {
    name: "add_findings",
    description:
      "Record findings for the reviewer, as a batch. Each location is checked against the frozen diff and its lines are copied; " +
      "if any finding is invalid, nothing is added and every problem is reported. " +
      "Include requirement_gap findings for requested behaviour that is missing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        analysis_id: { type: "string", description: ANALYSIS_ID_DOC },
        findings: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Optional id (letters, digits, '_' or '-'); generated when omitted." },
              severity: { type: "string", enum: [...SEVERITIES], description: SEVERITY_DOC },
              kind: { type: "string", enum: [...FINDING_KINDS], description: FINDING_KIND_DOC },
              title: { type: "string", description: "One-line title." },
              body: { type: "string", description: "Explanation: what is wrong and why it matters." },
              ...LOCATION_PROPERTIES,
              suggestion: { type: "string", description: SUGGESTION_DOC },
              prompt: { type: "string", description: FINDING_PROMPT_DOC },
            },
            required: ["severity", "title", "body"],
          },
        },
      },
      required: ["analysis_id", "findings"],
    },
  },
  {
    name: "update_finding",
    description:
      "Change the fields of one finding: severity, kind, title, body, location, suggestion or prompt. " +
      "A new location is checked against the diff and reopens an outdated finding; path null removes the location. " +
      "Whether a finding is ignored is the reviewer's decision and cannot be changed here.",
    inputSchema: {
      type: "object" as const,
      properties: {
        analysis_id: { type: "string", description: ANALYSIS_ID_DOC },
        finding_id: { type: "string", description: "Id of the finding, as shown by get_analysis." },
        severity: { type: "string", enum: [...SEVERITIES], description: SEVERITY_DOC },
        kind: { type: "string", enum: [...FINDING_KINDS], description: "issue or requirement_gap." },
        title: { type: "string", description: "New title." },
        body: { type: "string", description: "New explanation." },
        path: {
          type: ["string", "null"],
          description: `${LOCATION_PROPERTIES.path.description} Give it with start_line to move the finding; null removes the location (requirement_gap only).`,
        },
        start_line: LOCATION_PROPERTIES.start_line,
        end_line: LOCATION_PROPERTIES.end_line,
        suggestion: { type: ["string", "null"], description: `${SUGGESTION_DOC} null clears it.` },
        prompt: { type: ["string", "null"], description: `${FINDING_PROMPT_DOC} null clears it.` },
      },
      required: ["analysis_id", "finding_id"],
    },
  },
  {
    name: "delete_findings",
    description:
      "Delete findings by id, typically once refresh_analysis shows them solved. The reviewer notes written on these findings are deleted with them. " +
      "If any id is unknown, nothing is deleted.",
    inputSchema: {
      type: "object" as const,
      properties: {
        analysis_id: { type: "string", description: ANALYSIS_ID_DOC },
        finding_ids: { type: "array", minItems: 1, items: { type: "string" }, description: "Ids of the findings to delete." },
      },
      required: ["analysis_id", "finding_ids"],
    },
  },
  {
    name: "add_explanations",
    description:
      "Explain blocks of added or removed code to the reviewer, as a batch: what each block does and how it works. " +
      "Write one for every long (about 30 lines or more) or complex block; skip trivial code. An explanation judges nothing: problems go in findings. " +
      "Each location is checked against the frozen diff and its lines are copied; if any explanation is invalid, nothing is added and every problem is reported.",
    inputSchema: {
      type: "object" as const,
      properties: {
        analysis_id: { type: "string", description: ANALYSIS_ID_DOC },
        explanations: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Optional id (letters, digits, '_' or '-'); generated when omitted." },
              title: { type: "string", description: 'Name of the block and its role, e.g. "parseUnifiedDiff: diff text to hunks".' },
              body: { type: "string", description: EXPLANATION_BODY_DOC },
              ...EXPLANATION_LOCATION_PROPERTIES,
            },
            required: ["title", "body", "path", "start_line"],
          },
        },
      },
      required: ["analysis_id", "explanations"],
    },
  },
  {
    name: "update_explanation",
    description:
      "Change one explanation: title, body or location. A new location (path and start_line, with side for removed code) is checked against the diff " +
      "and makes an outdated explanation current again; rewrite the body too when the code changed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        analysis_id: { type: "string", description: ANALYSIS_ID_DOC },
        explanation_id: { type: "string", description: "Id of the explanation, as shown by get_analysis." },
        title: { type: "string", description: "New title." },
        body: { type: "string", description: EXPLANATION_BODY_DOC },
        ...EXPLANATION_LOCATION_PROPERTIES,
      },
      required: ["analysis_id", "explanation_id"],
    },
  },
  {
    name: "delete_explanations",
    description: "Delete explanations by id, e.g. when the code they describe is gone. If any id is unknown, nothing is deleted.",
    inputSchema: {
      type: "object" as const,
      properties: {
        analysis_id: { type: "string", description: ANALYSIS_ID_DOC },
        explanation_ids: { type: "array", minItems: 1, items: { type: "string" }, description: "Ids of the explanations to delete." },
      },
      required: ["analysis_id", "explanation_ids"],
    },
  },
  {
    name: "set_diagram",
    description:
      "Create a diagram, or fully replace the one with diagram_id, when a picture helps the reviewer (impact perimeter, process flow, concept map). " +
      "Give nodes and links only, with no coordinates or colours: the GUI lays the diagram out and colours nodes by status. " +
      `${DIAGRAM_KIND_DOC} ${DIAGRAM_RULES_DOC}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        analysis_id: { type: "string", description: ANALYSIS_ID_DOC },
        diagram_id: { type: "string", description: "Id of the diagram to replace, or of the new one; generated when omitted." },
        title: { type: "string", description: "Title of the diagram." },
        kind: { type: "string", enum: [...DIAGRAM_KINDS], description: DIAGRAM_KIND_DOC },
        layers: {
          type: "array",
          items: { type: "string" },
          description: "Required when kind is layers, forbidden otherwise: column names from left to right.",
        },
        nodes: {
          type: "array",
          minItems: 1,
          description: "Nodes in reading order (5 to 12): the declaration order is the initial order of every rank or column.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Node id, unique in the diagram; links refer to it." },
              label: { type: "string", description: "Text shown in the node." },
              shape: { type: "string", enum: [...NODE_SHAPES], description: NODE_SHAPE_DOC },
              status: { type: "string", enum: [...NODE_STATUSES], description: NODE_STATUS_DOC },
              layer: { type: "string", description: "Required when kind is layers: one of `layers`. Forbidden otherwise." },
              detail: { type: "string", description: "Longer description shown on hover." },
              path: {
                type: "string",
                description: "Changed file the node stands for; clicking the node opens it in the review. Omit it for code outside the diff.",
              },
              line: { type: "integer", minimum: 1, description: `Line to open in that file. ${LINE_NUMBERS_DOC} Needs path.` },
            },
            required: ["id", "label"],
          },
        },
        links: {
          type: "array",
          items: {
            type: "object",
            properties: {
              from: { type: "string", description: "Id of the source node." },
              to: { type: "string", description: "Id of the target node." },
              label: { type: "string", description: "Text shown on the link." },
            },
            required: ["from", "to"],
          },
          description: "Directed links between nodes (default: none). In a mindmap, from parent to child.",
        },
      },
      required: ["analysis_id", "title", "kind", "nodes"],
    },
  },
  {
    name: "delete_diagram",
    description: "Delete a diagram from an analysis.",
    inputSchema: {
      type: "object" as const,
      properties: {
        analysis_id: { type: "string", description: ANALYSIS_ID_DOC },
        diagram_id: { type: "string", description: "Id of the diagram, as shown by get_analysis." },
      },
      required: ["analysis_id", "diagram_id"],
    },
  },
  {
    name: "get_review_feedback",
    description:
      "Read the reviewer's feedback once the review is submitted: decision, selected findings and notes, and the prompt to act on. " +
      "Before submission it reports the review progress. Read-only. Always read the feedback before calling refresh_analysis, which discards it.",
    inputSchema: {
      type: "object" as const,
      properties: { analysis_id: { type: "string", description: ANALYSIS_ID_DOC } },
      required: ["analysis_id"],
    },
  },
  {
    name: "refresh_analysis",
    description:
      "Recompute the frozen diff with the same repository, mode and refs, after fixing the code. " +
      "Files whose diff changed become unreviewed, findings whose lines changed become outdated, and the review restarts as pending: " +
      "the previous feedback is discarded, so read it with get_review_feedback first.",
    inputSchema: {
      type: "object" as const,
      properties: { analysis_id: { type: "string", description: ANALYSIS_ID_DOC } },
      required: ["analysis_id"],
    },
  },
  {
    name: "delete_analysis",
    description: "Delete an analysis and its frozen diff. The repository is not touched. Also removes an analysis listed as unreadable.",
    inputSchema: {
      type: "object" as const,
      properties: { analysis_id: { type: "string", description: ANALYSIS_ID_DOC } },
      required: ["analysis_id"],
    },
  },
  reconnectGuiToolDefinition(),
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

/** Notifie la GUI d'une mutation et ajoute le lien vers l'analyse au résultat. */
function afterMutation({ result, analysisId }: MutationResult): ToolResult {
  notifyAnalysisChanged(analysisId);
  return { ...result, content: [{ type: "text", text: result.content[0].text + guiHint(analysisId) }] };
}

/**
 * Donne à `fn` l'accès aux dépôts du rôle : git local en `standalone` ; en `remote`,
 * commandes exécutées sur la machine de l'agent par le relais, qui annonce cette
 * possibilité dans l'argument `exec`.
 */
function withRepoAccess(
  exec: unknown,
  fn: (repoFor: (repoPath: string) => RepoAccess) => Promise<ToolResult>
): Promise<ToolResult> {
  if (role === "standalone") return fn(localRepo);
  return handleAgentExec(exec, (run) => fn((repoPath) => agentRepo(repoPath, run)));
}

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;
  // L'argument réservé du relais agent accompagne tous les appels d'une route listée dans GATEWAY_EXEC_ROUTES.
  const { [EXEC_ARG]: exec, ...params } = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "list_analyses":
        return listAnalyses(store, params);
      case "get_analysis":
        return getAnalysis(store, params);
      case "get_diff":
        return getDiff(store, params);
      case "get_review_feedback":
        return getReviewFeedback(store, params);

      case "create_analysis":
        return await withRepoAccess(exec, async (repoFor) => {
          const mutation = await createAnalysis(store, params, repoFor);
          notifyAnalysesListChanged();
          return afterMutation(mutation);
        });
      case "update_analysis":
        return afterMutation(updateAnalysis(store, params));
      case "add_findings":
        return afterMutation(addFindings(store, params));
      case "update_finding":
        return afterMutation(updateFinding(store, params));
      case "delete_findings":
        return afterMutation(deleteFindings(store, params));
      case "add_explanations":
        return afterMutation(addExplanations(store, params));
      case "update_explanation":
        return afterMutation(updateExplanation(store, params));
      case "delete_explanations":
        return afterMutation(deleteExplanations(store, params));
      case "set_diagram":
        return afterMutation(setDiagram(store, params));
      case "delete_diagram":
        return afterMutation(deleteDiagram(store, params));
      case "refresh_analysis":
        return await withRepoAccess(exec, async (repoFor) => afterMutation(await refreshAnalysis(store, params, repoFor)));
      case "delete_analysis": {
        const { result, analysisId } = deleteAnalysis(store, params);
        notifyAnalysisChanged(analysisId);
        notifyAnalysesListChanged();
        return result;
      }

      case "reconnect_gui":
        return await reconnectGui(params);

      default:
        throw new Error(`Tool not found: ${name}`);
    }
  } catch (error: any) {
    return errorResult(error.message);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`MCP Server connected and running on stdio (role: ${role}, data dir: ${dataDir})`);
  launchGUI();
}

main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.error(`Uncaught Exception in MASTER: ${err.message}`);
  logger.error(err.stack || "No stack trace");
  guiLauncher.getProcess()?.kill("SIGTERM");
  process.exit(1);
});
