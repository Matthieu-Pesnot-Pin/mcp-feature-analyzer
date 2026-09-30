import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import type { AnalysisMode, FileEntry } from "../../shared/schemas/analysis.schema.js";
import { MAX_SNAPSHOT_FILE_BYTES, type FileDiff, type Hunk } from "../../shared/schemas/diff.schema.js";
import { splitLines } from "../../shared/text.js";
import { parseUnifiedDiff, toPosixPath, type ParsedFileDiff } from "./diff-parser.js";
import { GitError } from "./errors.js";

/** Plafond de la sortie d'une commande git. */
const GIT_MAX_BUFFER = 512 * 1024 * 1024;

/** Ref de tête utilisée en mode `branch` quand aucune n'est fournie. */
export const DEFAULT_HEAD_REF = "HEAD";

export interface SnapshotRequest {
  /** Chemin absolu de la racine du dépôt git. */
  repoPath: string;
  mode: AnalysisMode;
  /** Ref de base, requise en mode `branch` ; absente ou "HEAD" en mode `working_tree`. */
  base?: string | null;
  /** Ref de tête en mode `branch`, `HEAD` par défaut ; interdite en mode `working_tree`. */
  head?: string | null;
}

/** Snapshot calculé : refs effectives, métadonnées des fichiers et diff figé. */
export interface ComputedSnapshot {
  repoPath: string;
  mode: AnalysisMode;
  /** Ref de base effective ; "HEAD" en mode `working_tree`. */
  base: string;
  /** Ref de tête effective en mode `branch` ; null en mode `working_tree`. */
  head: string | null;
  baseCommit: string;
  headCommit: string | null;
  snapshotAt: string;
  files: FileEntry[];
  diff: FileDiff[];
}

/**
 * Accès au dépôt sur la machine qui le porte : git et copie de travail.
 * Un contenu `null` dépasse ce que l'accès sait transférer.
 */
export interface RepoAccess {
  /** Vérifie que le chemin du dépôt désigne la racine d'un dépôt git. */
  assertRepoRoot(): Promise<void>;
  /** Résout une ref en sha de commit ; erreur explicite si elle est inconnue. */
  resolveCommit(ref: string, role: string): Promise<string>;
  /** Sortie de `git diff` (DIFF_ARGS) pour `range`, par ex. `["<base>...<head>"]` ou `["HEAD"]`. */
  diff(range: string[]): Promise<string>;
  /** Contenu des fichiers `paths` dans le commit `commit`. */
  readCommitFiles(commit: string, paths: string[]): Promise<Map<string, Buffer | null>>;
  /** Fichiers non suivis et non ignorés, chemins POSIX relatifs au dépôt. */
  untrackedFiles(): Promise<string[]>;
  /** Contenu des fichiers `paths` de la copie de travail ; un lien symbolique donne sa cible. */
  readWorkingFiles(paths: string[]): Promise<Map<string, Buffer | null>>;
}

/**
 * Lance git sans shell, dans `cwd`, et renvoie stdout (texte UTF-8 ou octets bruts).
 * `input` est écrit sur l'entrée standard de la commande.
 */
function runGit(cwd: string, args: string[], encoding: "utf-8", input?: string): Promise<string>;
function runGit(cwd: string, args: string[], encoding: "buffer", input?: string): Promise<Buffer>;
function runGit(cwd: string, args: string[], encoding: "utf-8" | "buffer", input?: string): Promise<string | Buffer> {
  const fullArgs = ["-c", "core.quotepath=false", ...args];
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      fullArgs,
      { cwd, maxBuffer: GIT_MAX_BUFFER, encoding: encoding === "buffer" ? "buffer" : "utf8", windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            reject(new GitError("The git executable was not found on PATH. Install git and restart the MCP server."));
            return;
          }
          const detail = String(stderr).trim() || error.message;
          reject(new GitError(`git ${args.join(" ")} failed in ${cwd}: ${detail}`));
          return;
        }
        resolve(stdout);
      }
    );
    child.stdin?.end(input ?? "");
  });
}

/** Chemin réel et normalisé, comparable entre deux écritures du même répertoire. */
function canonical(value: string): string {
  const real = path.resolve(fs.realpathSync.native(value));
  return process.platform === "win32" ? real.toLowerCase() : real;
}

/** Vérifie que `repoPath` est un chemin absolu vers la racine d'un dépôt git. */
async function assertRepoRoot(repoPath: string): Promise<void> {
  if (!path.isAbsolute(repoPath)) {
    throw new GitError(`repo_path must be an absolute path, got "${repoPath}".`);
  }
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    throw new GitError(`repo_path "${repoPath}" does not exist or is not a directory.`);
  }
  let topLevel: string;
  try {
    topLevel = (await runGit(repoPath, ["rev-parse", "--show-toplevel"], "utf-8")).trim();
  } catch (err) {
    if (err instanceof GitError && /not a git repository/i.test(err.message)) {
      throw new GitError(`repo_path "${repoPath}" is not inside a git repository.`);
    }
    throw err;
  }
  if (canonical(topLevel) !== canonical(repoPath)) {
    throw new GitError(
      `repo_path "${repoPath}" is not the root of its git repository. Use the repository root: ${path.resolve(topLevel)}`
    );
  }
}

/** Résout une ref en sha de commit ; erreur explicite si elle est inconnue. */
async function resolveCommit(repoPath: string, ref: string, role: string): Promise<string> {
  assertRefShape(ref, role);
  try {
    return (await runGit(repoPath, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], "utf-8")).trim();
  } catch {
    throw new GitError(
      `Unknown ${role} ref "${ref}" in ${repoPath}. Use a branch name, a tag or a commit sha that exists in this repository.`
    );
  }
}

export const DIFF_ARGS = [
  "-c",
  "diff.noprefix=false",
  "-c",
  "diff.mnemonicPrefix=false",
  "diff",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--no-relative",
  "--find-renames",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

/** Vrai si le contenu contient un octet nul dans ses 8000 premiers octets (même règle que git). */
export function looksBinary(content: Buffer): boolean {
  return content.subarray(0, 8000).includes(0);
}

/** Hunk unique d'un fichier ajouté, toutes lignes en ajout. */
function additionHunk(lines: string[]): Hunk[] {
  if (lines.length === 0) return [];
  return [
    {
      header: `@@ -0,0 +1,${lines.length} @@`,
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: lines.length,
      lines: lines.map((text, index) => ({ type: "add" as const, oldNo: null, newNo: index + 1, text })),
    },
  ];
}

/** Contenu d'un fichier de la copie de travail ; un lien symbolique donne sa cible, comme dans git. */
function readWorkingFile(repoPath: string, filePath: string): Buffer {
  const absolute = path.join(repoPath, ...filePath.split("/"));
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) return Buffer.from(toPosixPath(fs.readlinkSync(absolute)), "utf-8");
  return fs.readFileSync(absolute);
}

/** Texte conservé dans le snapshot, ou null quand le contenu est absent ou dépasse MAX_SNAPSHOT_FILE_BYTES. */
function snapshotText(content: Buffer | null | undefined): string | null {
  if (content == null || content.length > MAX_SNAPSHOT_FILE_BYTES) return null;
  return content.toString("utf-8");
}

function toEntry(parsed: ParsedFileDiff, newContent: string | null): { entry: FileEntry; diff: FileDiff } {
  return {
    entry: {
      path: parsed.path,
      oldPath: parsed.oldPath,
      status: parsed.status,
      additions: parsed.additions,
      deletions: parsed.deletions,
      binary: parsed.binary,
      contentAvailable: newContent !== null,
      lineCount: newContent === null ? 0 : splitLines(newContent).length,
      reviewed: false,
    },
    diff: { path: parsed.path, hunks: parsed.hunks, newContent },
  };
}

/**
 * Contenu des fichiers `paths` dans le commit `commit`, en deux commandes git
 * quel que soit leur nombre : `ls-tree` donne l'objet de chaque chemin, puis
 * `cat-file --batch` lit tous les objets d'un coup.
 */
async function readCommitFiles(repoPath: string, commit: string, paths: string[]): Promise<Map<string, Buffer | null>> {
  const contents = new Map<string, Buffer | null>();
  if (paths.length === 0) return contents;

  const blobs = new Map<string, string>();
  for (const entry of (await runGit(repoPath, ["ls-tree", "-r", "-z", "--full-tree", commit], "utf-8")).split("\0")) {
    if (entry === "") continue;
    const tab = entry.indexOf("\t");
    const [, type, sha] = entry.slice(0, tab).split(" ");
    if (type === "blob") blobs.set(entry.slice(tab + 1), sha);
  }
  const shas = paths.map((filePath) => {
    const sha = blobs.get(filePath);
    if (sha === undefined) {
      throw new GitError(`"${filePath}" is in the diff but is not a file of commit ${commit} (submodule or unreadable entry).`);
    }
    return sha;
  });

  const output = await runGit(repoPath, ["cat-file", "--batch"], "buffer", shas.join("\n") + "\n");
  let offset = 0;
  paths.forEach((filePath, index) => {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd === -1) throw new GitError(`git cat-file --batch ended before the content of "${filePath}".`);
    const header = output.subarray(offset, headerEnd).toString("utf-8");
    const [sha, type, size] = header.split(" ");
    if (sha !== shas[index] || type !== "blob" || size === undefined) {
      throw new GitError(`Unexpected git cat-file --batch header "${header}" for "${filePath}".`);
    }
    const start = headerEnd + 1;
    contents.set(filePath, output.subarray(start, start + Number(size)));
    offset = start + Number(size) + 1;
  });
  return contents;
}

/** Accès direct au dépôt, sur la machine de ce serveur. */
export function localRepo(repoPath: string): RepoAccess {
  return {
    assertRepoRoot: () => assertRepoRoot(repoPath),
    resolveCommit: (ref, role) => resolveCommit(repoPath, ref, role),
    diff: (range) => runGit(repoPath, [...DIFF_ARGS, ...range, "--"], "utf-8"),
    readCommitFiles: (commit, paths) => readCommitFiles(repoPath, commit, paths),
    untrackedFiles: async () =>
      (await runGit(repoPath, ["ls-files", "--others", "--exclude-standard", "-z"], "utf-8"))
        .split("\0")
        .filter((entry) => entry !== "")
        .map(toPosixPath),
    readWorkingFiles: async (paths) => new Map(paths.map((filePath) => [filePath, readWorkingFile(repoPath, filePath)])),
  };
}

/** Vérifie une ref fournie par l'agent avant de la passer à git. */
export function assertRefShape(ref: string, role: string): void {
  if (ref.startsWith("-")) {
    throw new GitError(`Invalid ${role} ref "${ref}": a ref cannot start with "-".`);
  }
}

async function branchSnapshot(repo: RepoAccess, base: string, head: string) {
  const baseCommit = await repo.resolveCommit(base, "base");
  const headCommit = await repo.resolveCommit(head, "head");
  const output = await repo.diff([`${baseCommit}...${headCommit}`]);

  const parsedFiles = parseUnifiedDiff(output);
  const withContent = parsedFiles.filter((parsed) => parsed.status !== "deleted" && !parsed.binary).map((parsed) => parsed.path);
  const contents = await repo.readCommitFiles(headCommit, withContent);
  const results = parsedFiles.map((parsed) => toEntry(parsed, snapshotText(contents.get(parsed.path))));
  return { baseCommit, headCommit, results };
}

async function workingTreeSnapshot(repo: RepoAccess) {
  const baseCommit = await repo.resolveCommit("HEAD", "base");
  const parsedFiles = parseUnifiedDiff(await repo.diff(["HEAD"]));
  const withContent = parsedFiles.filter((parsed) => parsed.status !== "deleted" && !parsed.binary).map((parsed) => parsed.path);
  const contents = await repo.readWorkingFiles(withContent);
  const results = parsedFiles.map((parsed) => toEntry(parsed, snapshotText(contents.get(parsed.path))));

  const untracked = await repo.untrackedFiles();
  const untrackedContents = await repo.readWorkingFiles(untracked);
  for (const filePath of untracked) {
    const raw = untrackedContents.get(filePath);
    if (raw == null) {
      throw new GitError(
        `The untracked file "${filePath}" is too large to be transferred from the repository's machine. Add it to .gitignore or remove it, then try again.`
      );
    }
    const binary = looksBinary(raw);
    const content = binary ? null : snapshotText(raw);
    const lines = binary ? [] : splitLines(raw.toString("utf-8"));
    const hunks = additionHunk(lines);
    results.push(
      toEntry(
        { path: filePath, oldPath: null, status: "added", binary, hunks, additions: lines.length, deletions: 0 },
        content
      )
    );
  }
  return { baseCommit, headCommit: null, results };
}

/**
 * Calcule le snapshot d'une analyse avec git, par `repo` (accès local par défaut).
 * - `branch` : diff `base...head` (head vaut `HEAD` par défaut), contenu lu dans le commit de tête ;
 * - `working_tree` : diff de HEAD vers la copie de travail, index compris, fichiers non suivis
 *   présentés comme ajoutés, contenu lu sur disque.
 * Les fichiers sont triés par chemin ; `reviewed` vaut false partout.
 */
export async function computeSnapshot(
  request: SnapshotRequest,
  repo: RepoAccess = localRepo(request.repoPath)
): Promise<ComputedSnapshot> {
  const { repoPath, mode } = request;
  await repo.assertRepoRoot();

  let base: string;
  let head: string | null;
  let computed: { baseCommit: string; headCommit: string | null; results: Array<{ entry: FileEntry; diff: FileDiff }> };
  if (mode === "branch") {
    const requestedBase = request.base?.trim();
    if (!requestedBase) throw new GitError(`"base" is required in branch mode: give the ref the feature branched from.`);
    base = requestedBase;
    head = request.head?.trim() || DEFAULT_HEAD_REF;
    computed = await branchSnapshot(repo, base, head);
  } else if (mode === "working_tree") {
    if (request.head != null && request.head.trim() !== "") {
      throw new GitError(`"head" is not accepted in working_tree mode: the working tree is compared against HEAD.`);
    }
    if (request.base != null && request.base.trim() !== "" && request.base.trim() !== "HEAD") {
      throw new GitError(`"base" is not accepted in working_tree mode: the working tree is always compared against HEAD.`);
    }
    base = "HEAD";
    head = null;
    computed = await workingTreeSnapshot(repo);
  } else {
    throw new GitError(`Unknown mode "${String(mode)}": use "branch" or "working_tree".`);
  }

  computed.results.sort((a, b) => (a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0));
  return {
    repoPath,
    mode,
    base,
    head,
    baseCommit: computed.baseCommit,
    headCommit: computed.headCommit,
    snapshotAt: new Date().toISOString(),
    files: computed.results.map((result) => result.entry),
    diff: computed.results.map((result) => result.diff),
  };
}
