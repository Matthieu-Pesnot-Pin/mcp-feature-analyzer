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
import { IPCMessageSchema, type IPCMessage } from "../shared/schemas/ipc.schema.js";
import { errorResult, textResult, type ToolResult } from "./tools/types.js";

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

const dataDir = resolveDataDir(rootDir);

const server = new Server({ name: "mcp-feature-analyzer", version: APP_VERSION }, { capabilities: { tools: {} } });

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

/** Notifie la GUI qu'une analyse a changé côté agent, pour qu'elle se rafraîchisse. */
function notifyAnalysisChanged(analysisId: string) {
  broadcastToGUI({ type: "ANALYSIS_UPDATED", data: { analysisId }, timestamp: new Date().toISOString() });
}

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
      broadcastToGUI({ type: "INITIAL_STATE", data: { version: APP_VERSION }, timestamp: new Date().toISOString() });
      return;

    case "GET_CONFIG":
      reply(msg, "GET_CONFIG_RESPONSE", { dataDir, version: APP_VERSION });
      return;

    default:
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

// --- Outils MCP -------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [reconnectGuiToolDefinition()],
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;
  const params = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
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
  logger.info(`MCP Server connected and running on stdio (data dir: ${dataDir})`);
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
