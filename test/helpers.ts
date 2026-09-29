import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { fileURLToPath } from "url";
import { AnalysisStore } from "../src/core/analysis-store.js";
import type { ComputedSnapshot } from "../src/core/git.js";
import type { Analysis, Finding } from "../shared/schemas/analysis.schema.js";

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

/** Exécute git dans `cwd` et renvoie stdout. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

function writeFile(root: string, relative: string, content: string | Buffer) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/** Contenu de `src/app.ts` sur master : 30 lignes numérotées. */
export const APP_LINES = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);

/**
 * Dépôt git temporaire : un commit initial sur `master`, puis une branche
 * `feature` (extraite) qui modifie `src/app.ts` en deux endroits, ajoute
 * `src/new file.ts`, supprime `remove.txt`, renomme `docs/old name.md` en
 * `docs/new name.md`, modifie le binaire `logo.bin`, un fichier CRLF et un
 * fichier sans fin de ligne finale.
 */
export function makeGitRepo(): { dir: string; cleanup: () => void } {
  const temp = makeTempDir("mcp-feature-analyzer-repo-");
  const dir = fs.realpathSync.native(temp.dir);
  git(dir, "init", "-q", "-b", "master");
  git(dir, "config", "user.name", "Test User");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "config", "commit.gpgsign", "false");

  writeFile(dir, "src/app.ts", APP_LINES.join("\n") + "\n");
  writeFile(dir, "remove.txt", "to be removed\n");
  writeFile(dir, "docs/old name.md", "# Title\n\nSome documentation that stays the same.\nAnother line.\n");
  writeFile(dir, "logo.bin", Buffer.from([0, 1, 2, 3, 0, 255]));
  writeFile(dir, "crlf.txt", "alpha\r\nbeta\r\ngamma\r\n");
  writeFile(dir, "nonl.txt", "first\nlast");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "initial");

  git(dir, "checkout", "-q", "-b", "feature");
  const app = [...APP_LINES];
  app[1] = "line 2 changed";
  app.splice(25, 0, "inserted after 25");
  writeFile(dir, "src/app.ts", app.join("\n") + "\n");
  writeFile(dir, "src/new file.ts", "export const added = 1;\nexport const other = 2;\n");
  fs.rmSync(path.join(dir, "remove.txt"));
  git(dir, "mv", "docs/old name.md", "docs/new name.md");
  writeFile(dir, "logo.bin", Buffer.from([0, 9, 9, 9, 0, 255]));
  writeFile(dir, "crlf.txt", "alpha\r\nBETA\r\ngamma\r\n");
  writeFile(dir, "nonl.txt", "first\nlast\nafter");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "feature work");

  return { dir, cleanup: temp.cleanup };
}

/** Store sur un répertoire de données temporaire. */
export function makeStore(): { store: AnalysisStore; dir: string; cleanup: () => void } {
  const temp = makeTempDir("mcp-feature-analyzer-store-");
  return { store: new AnalysisStore(temp.dir), dir: temp.dir, cleanup: temp.cleanup };
}

/** Snapshot calculé fictif : `src/a.ts` (5 lignes, modifié) et `img.png` (binaire). */
export function sampleSnapshot(overrides: Partial<ComputedSnapshot> = {}): ComputedSnapshot {
  const content = "one\ntwo\nthree\nfour\nfive\n";
  return {
    repoPath: "/repo",
    mode: "branch",
    base: "master",
    head: "HEAD",
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40),
    snapshotAt: "2026-09-29T10:00:00.000Z",
    files: [
      { path: "img.png", oldPath: null, status: "modified", additions: 0, deletions: 0, binary: true, contentAvailable: false, lineCount: 0, reviewed: false },
      { path: "src/a.ts", oldPath: null, status: "modified", additions: 1, deletions: 1, binary: false, contentAvailable: true, lineCount: 5, reviewed: false },
    ],
    diff: [
      { path: "img.png", hunks: [], newContent: null },
      {
        path: "src/a.ts",
        newContent: content,
        hunks: [
          {
            header: "@@ -1,3 +1,3 @@",
            oldStart: 1,
            oldLines: 3,
            newStart: 1,
            newLines: 3,
            lines: [
              { type: "context", oldNo: 1, newNo: 1, text: "one" },
              { type: "del", oldNo: 2, newNo: null, text: "TWO" },
              { type: "add", oldNo: null, newNo: 2, text: "two" },
              { type: "context", oldNo: 3, newNo: 3, text: "three" },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

/** Analyse complète construite sans disque, cohérente avec `sampleSnapshot()`. */
export function sampleAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  const snapshot = sampleSnapshot();
  return {
    id: "sample-abc123",
    title: "OAuth refresh",
    repoPath: snapshot.repoPath,
    mode: snapshot.mode,
    base: snapshot.base,
    head: snapshot.head,
    baseCommit: snapshot.baseCommit,
    headCommit: snapshot.headCommit,
    snapshotAt: snapshot.snapshotAt,
    request: null,
    summary: [],
    files: structuredClone(snapshot.files),
    findings: [],
    notes: [],
    diagrams: [],
    review: { state: "pending", decision: null, selectedFindingIds: [], selectedNoteIds: [], prompt: null, submittedAt: null },
    revision: 0,
    createdAt: "2026-09-29T10:00:00.000Z",
    updatedAt: "2026-09-29T10:00:00.000Z",
    lastEditor: "agent",
    ...overrides,
  };
}

/** Constat ouvert sur les lignes 2-3 de `src/a.ts`, complété par `overrides`. */
export function sampleFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f_1",
    severity: "major",
    kind: "issue",
    title: "Wrong value",
    body: "",
    location: { path: "src/a.ts", startLine: 2, endLine: 3 },
    anchorText: "two\nthree",
    suggestion: null,
    prompt: null,
    status: "open",
    createdAt: "2026-09-29T10:00:00.000Z",
    ...overrides,
  };
}
