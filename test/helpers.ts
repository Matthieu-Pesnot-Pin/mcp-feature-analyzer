import fs from "fs";
import os from "os";
import path from "path";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Point d'entrée compilé du serveur MCP. */
export const SERVER_ENTRY = path.resolve(__dirname, "../src/index.js");

/** Crée un répertoire temporaire et renvoie sa fonction de suppression. */
export function makeTempDir(prefix: string): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Client JSON-RPC minimal sur stdio : lance le serveur MCP compilé avec
 * l'environnement fourni et associe chaque réponse à sa requête par `id`.
 */
export class McpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<number, (message: any) => void>();
  readonly stderr: string[] = [];
  readonly strayStdout: string[] = [];

  constructor(env: Record<string, string | undefined>) {
    this.child = spawn(process.execPath, [SERVER_ENTRY], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    this.child.stdout.setEncoding("utf-8");
    this.child.stdout.on("data", (chunk: string) => this.consume(chunk));
    this.child.stderr.setEncoding("utf-8");
    this.child.stderr.on("data", (chunk: string) => this.stderr.push(chunk));
  }

  private consume(chunk: string) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line !== "") {
        try {
          const message = JSON.parse(line);
          const resolve = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
          if (resolve) {
            this.pending.delete(message.id);
            resolve(message);
          }
        } catch {
          // Toute ligne non JSON-RPC sur stdout casse le protocole MCP : elle est conservée pour les assertions.
          this.strayStdout.push(line);
        }
      }
      newline = this.buffer.indexOf("\n");
    }
  }

  request(method: string, params?: unknown, timeoutMs = 20000): Promise<any> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result);
      });

      this.child.stdin.write(payload);
    });
  }

  notify(method: string, params?: unknown) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  /** Handshake MCP : `initialize` puis `notifications/initialized`. */
  async initialize(clientName: string) {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: clientName, version: "1.0.0" },
    });
    this.notify("notifications/initialized");
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
    const result = await this.request("tools/call", { name, arguments: args });
    return {
      text: result.content.map((entry: { text: string }) => entry.text).join("\n"),
      isError: result.isError === true,
    };
  }

  /** Ferme stdin (le serveur arrête son GUI worker) puis attend la fin du processus. */
  async stop() {
    if (this.child.exitCode !== null) return;
    const exited = new Promise((resolve) => this.child.once("exit", resolve));
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill(), 5000);
    await exited;
    clearTimeout(timer);
  }
}

/** Environnement du processus courant sans les variables qui activent la GUI ou fixent les répertoires. */
export function baseEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of [
    "PROXY_URL",
    "APP_PORT",
    "APP_PATH",
    "APP_PATH_PREFIX",
    "APP_NAME",
    "APP_GROUP",
    "MCP_FEATURE_ANALYZER_DATA_DIR",
    "MCP_DATA_DIR",
    "MCP_LOG_DIR",
  ]) {
    delete env[key];
  }
  return env;
}
