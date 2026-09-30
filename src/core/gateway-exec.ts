/**
 * Exécution de commandes sur la machine de l'agent, par le relais agent de
 * mcp-http-gateway (`mcp-http-gateway --mcp`).
 *
 * Convention, entre le relais agent et un MCP placé derrière le gateway :
 *
 * - Quand la route de ce MCP figure dans sa liste blanche (GATEWAY_EXEC_ROUTES), le
 *   relais agent ajoute à chaque appel d'outil l'argument réservé `_gateway_exec` :
 *   `{ version, cwd, gatewayToken }`. `cwd` est son dossier de lancement.
 * - Le MCP peut répondre par une demande d'exécution au lieu d'un résultat final :
 *   `_meta["gateway/exec"] = { id, steps }`. Chaque étape est `{ command, args, cwd, env }`,
 *   lancée sans shell ; `cwd` est résolu par rapport au dossier de lancement du relais.
 * - Le relais agent exécute les étapes dans l'ordre et s'arrête à la première qui
 *   échoue. Il rappelle alors le même outil avec
 *   `_gateway_exec.continuation = { id, results }`, un résultat par étape exécutée.
 *   La sortie standard de chaque étape est tronquée au-delà de 1 Mio.
 *
 * Un outil s'écrit comme une fonction asynchrone qui appelle `run(steps)` : chaque
 * appel suspend la fonction jusqu'au rappel du relais agent qui porte les résultats.
 */
import { randomUUID } from "crypto";
import type { ToolResult } from "../tools/types.js";

export const EXEC_ARG = "_gateway_exec";
export const EXEC_META = "gateway/exec";
export const EXEC_VERSION = 1;

/** Taille maximale de la sortie d'une étape conservée par le relais agent. */
export const RELAY_MAX_OUTPUT_BYTES = 1024 * 1024;

/** Mention ajoutée par le relais agent à la fin d'une sortie tronquée. */
const TRUNCATION_MARK = /\n\[sortie tronquée à \d+ octets\]$/;

/** Délai laissé au relais agent pour rendre les résultats d'une demande. */
const CONTINUATION_TTL_MS = 30 * 60 * 1000;

export interface ExecStep {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface StepResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export type Run = (steps: ExecStep[]) => Promise<StepResult[]>;

/** Vrai si le relais agent a tronqué cette sortie. */
export function isTruncated(output: string): boolean {
  return TRUNCATION_MARK.test(output);
}

type FlowEvent =
  | { kind: "exec"; steps: ExecStep[] }
  | { kind: "done"; result: ToolResult }
  | { kind: "failed"; error: Error };

interface Flow {
  id: string;
  /** Rend l'événement suivant de la fonction : demande d'exécution, résultat ou échec. */
  emit: (event: FlowEvent) => void;
  /** Reprend la fonction suspendue dans `run` avec les résultats du relais agent. */
  resume?: ((results: StepResult[]) => void) | undefined;
  abort?: ((error: Error) => void) | undefined;
  steps?: ExecStep[];
  timer?: NodeJS.Timeout;
}

const flows = new Map<string, Flow>();

function nextEvent(flow: Flow): Promise<FlowEvent> {
  return new Promise((resolve) => {
    flow.emit = resolve;
  });
}

function toToolResult(flow: Flow, event: FlowEvent): ToolResult {
  if (event.kind === "done") {
    flows.delete(flow.id);
    return event.result;
  }
  if (event.kind === "failed") {
    flows.delete(flow.id);
    throw event.error;
  }
  flow.steps = event.steps;
  flow.timer = setTimeout(() => {
    flows.delete(flow.id);
    flow.abort?.(new Error("Timed out waiting for the agent relay to return the command results."));
  }, CONTINUATION_TTL_MS);
  flow.timer.unref();
  return {
    content: [{ type: "text", text: "Command execution request for the agent's machine, to be handled by the agent relay." }],
    _meta: { [EXEC_META]: { id: flow.id, steps: event.steps } },
  };
}

function assertAnnounced(raw: any): void {
  if (!raw || typeof raw !== "object") {
    const route = process.env.MCP_SERVER_ROUTE?.trim() || "the route of this MCP";
    throw new Error(
      "This tool runs git on the agent's machine, through the agent relay (mcp-http-gateway --mcp), " +
        `and the relay did not offer command execution: add ${route} to GATEWAY_EXEC_ROUTES in the "env" block ` +
        "of the relay configuration, with a version of mcp-http-gateway that supports it."
    );
  }
  if (raw.version !== EXEC_VERSION) {
    throw new Error(`Unsupported agent relay execution version: ${raw.version} (expected ${EXEC_VERSION}).`);
  }
}

function parseResults(raw: any, steps: ExecStep[]): StepResult[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > steps.length) {
    throw new Error("Invalid command results from the agent relay: one result is expected per step run.");
  }
  return raw.map((r: any) => ({
    code: typeof r?.code === "number" ? r.code : null,
    stdout: typeof r?.stdout === "string" ? r.stdout : "",
    stderr: typeof r?.stderr === "string" ? r.stderr : "",
    ...(typeof r?.error === "string" ? { error: r.error } : {}),
  }));
}

/**
 * Point d'entrée d'un outil qui s'exécute sur la machine de l'agent. Au premier appel,
 * démarre `tool` ; aux rappels du relais agent, reprend la fonction là où elle attend.
 * `exec` est la valeur de l'argument `_gateway_exec` de l'appel.
 */
export async function handleAgentExec(exec: unknown, tool: (run: Run) => Promise<ToolResult>): Promise<ToolResult> {
  assertAnnounced(exec);

  const continuation = (exec as { continuation?: any }).continuation;
  if (continuation) {
    const flow = flows.get(continuation.id);
    if (!flow || !flow.resume || !flow.steps) {
      throw new Error("Unknown or expired execution continuation (the MCP server may have restarted): call the tool again.");
    }
    const results = parseResults(continuation.results, flow.steps);
    clearTimeout(flow.timer);
    const resume = flow.resume;
    flow.resume = undefined;
    flow.abort = undefined;
    const event = nextEvent(flow);
    resume(results);
    return toToolResult(flow, await event);
  }

  const flow: Flow = { id: randomUUID(), emit: () => {} };
  flows.set(flow.id, flow);
  const event = nextEvent(flow);

  const run: Run = (steps) =>
    new Promise((resolve, reject) => {
      flow.resume = resolve;
      flow.abort = reject;
      flow.emit({ kind: "exec", steps });
    });

  tool(run).then(
    (result) => flow.emit({ kind: "done", result }),
    (error) => flow.emit({ kind: "failed", error })
  );

  return toToolResult(flow, await event);
}
