import type { FileStatus } from "../../shared/schemas/analysis.schema.js";
import type { DiffLine, Hunk } from "../../shared/schemas/diff.schema.js";
import { GitError } from "./errors.js";

/** Diff d'un fichier tel que lu dans la sortie de `git diff`. */
export interface ParsedFileDiff {
  /** Chemin côté « nouveau » ; chemin supprimé pour un fichier supprimé. */
  path: string;
  /** Ancien chemin d'un fichier renommé ; null sinon. */
  oldPath: string | null;
  status: FileStatus;
  binary: boolean;
  hunks: Hunk[];
  additions: number;
  deletions: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Retire le `\r` final d'une ligne lue dans une sortie découpée sur `\n`. */
function stripCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** Remplace les antislashs par des slashs. */
export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };

/**
 * Décode un chemin entre guillemets tel que git l'écrit (échappements C et
 * octets en octal). `quoted` commence par `"` ; renvoie le chemin et la
 * position qui suit le guillemet fermant.
 */
function readQuoted(quoted: string, start: number): { value: string; end: number } {
  const bytes: number[] = [];
  let i = start + 1;
  while (i < quoted.length) {
    const char = quoted[i];
    if (char === '"') {
      return { value: Buffer.from(bytes).toString("utf-8"), end: i + 1 };
    }
    if (char === "\\") {
      const next = quoted[i + 1];
      if (next !== undefined && /[0-7]/.test(next)) {
        bytes.push(parseInt(quoted.slice(i + 1, i + 4), 8));
        i += 4;
        continue;
      }
      if (next !== undefined && ESCAPES[next] !== undefined) {
        bytes.push(ESCAPES[next]);
        i += 2;
        continue;
      }
      throw new GitError(`Unexpected escape sequence in git path: ${quoted}`);
    }
    bytes.push(...Buffer.from(char, "utf-8"));
    i += 1;
  }
  throw new GitError(`Unterminated quoted path in git output: ${quoted}`);
}

/** Chemin d'une ligne `--- a/x`, `+++ b/x`, `rename from x` : décode les guillemets, retire le préfixe. */
function readPathField(raw: string, prefix: string | null): string | null {
  // git ajoute une tabulation après un chemin contenant une espace.
  const field = raw.endsWith("\t") ? raw.slice(0, -1) : raw;
  if (field === "/dev/null") return null;
  const value = field.startsWith('"') ? readQuoted(field, 0).value : field;
  if (prefix === null) return value;
  if (!value.startsWith(prefix)) {
    throw new GitError(`Unexpected path "${value}" in git diff output: expected the "${prefix}" prefix.`);
  }
  return value.slice(prefix.length);
}

/** Chemins ancien et nouveau de la ligne `diff --git a/x b/y`, quand elle est décodable sans ambiguïté. */
function readGitHeader(rest: string): { oldPath: string; newPath: string } | null {
  if (rest.startsWith('"')) {
    const first = readQuoted(rest, 0);
    const second = rest.slice(first.end + 1);
    const newPath = second.startsWith('"') ? readQuoted(second, 0).value : second;
    return strip(first.value, newPath);
  }
  const quotedSecond = rest.indexOf(' "b/');
  if (quotedSecond !== -1 && rest.endsWith('"')) {
    return strip(rest.slice(0, quotedSecond), readQuoted(rest, quotedSecond + 1).value);
  }
  // Sans guillemets, seul le cas symétrique « a/P b/P » se découpe sans ambiguïté.
  if ((rest.length - 5) % 2 !== 0) return null;
  const length = (rest.length - 5) / 2;
  const candidate = rest.slice(2, 2 + length);
  if (rest !== `a/${candidate} b/${candidate}`) return null;
  return { oldPath: candidate, newPath: candidate };

  function strip(oldValue: string, newValue: string): { oldPath: string; newPath: string } | null {
    if (!oldValue.startsWith("a/") || !newValue.startsWith("b/")) return null;
    return { oldPath: oldValue.slice(2), newPath: newValue.slice(2) };
  }
}

interface FileBlock {
  header: { oldPath: string; newPath: string } | null;
  headerLine: string;
  minusPath: string | null | undefined;
  plusPath: string | null | undefined;
  renameFrom: string | null;
  renameTo: string | null;
  isNew: boolean;
  isDeleted: boolean;
  binary: boolean;
  hunks: Hunk[];
}

function finish(block: FileBlock): ParsedFileDiff {
  let oldPath = block.renameFrom ?? (block.minusPath === undefined ? undefined : block.minusPath);
  let newPath = block.renameTo ?? (block.plusPath === undefined ? undefined : block.plusPath);
  if (oldPath === undefined) oldPath = block.isNew ? null : block.header?.oldPath;
  if (newPath === undefined) newPath = block.isDeleted ? null : block.header?.newPath;
  if (oldPath === undefined || newPath === undefined) {
    throw new GitError(`Cannot determine the file paths of this git diff entry: ${block.headerLine}`);
  }

  let status: FileStatus;
  if (block.isNew || oldPath === null) status = "added";
  else if (block.isDeleted || newPath === null) status = "deleted";
  else if (block.renameFrom !== null || oldPath !== newPath) status = "renamed";
  else status = "modified";

  const path = status === "deleted" ? oldPath : newPath;
  if (path === null) {
    throw new GitError(`Cannot determine the file path of this git diff entry: ${block.headerLine}`);
  }

  let additions = 0;
  let deletions = 0;
  for (const hunk of block.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") additions++;
      else if (line.type === "del") deletions++;
    }
  }

  return {
    path: toPosixPath(path),
    oldPath: status === "renamed" && oldPath !== null ? toPosixPath(oldPath) : null,
    status,
    binary: block.binary,
    hunks: block.hunks,
    additions,
    deletions,
  };
}

/**
 * Lit la sortie de `git diff` (format unifié, préfixes `a/` et `b/`) et renvoie
 * un diff par fichier. Les lignes `\ No newline at end of file` sont écartées ;
 * les `\r` de fin de ligne sont retirés du texte des lignes.
 */
export function parseUnifiedDiff(output: string): ParsedFileDiff[] {
  const lines = output.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();

  const files: ParsedFileDiff[] = [];
  let block: FileBlock | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = stripCr(lines[i]);

    if (line.startsWith("diff --git ")) {
      if (block) files.push(finish(block));
      block = {
        header: readGitHeader(line.slice("diff --git ".length)),
        headerLine: line,
        minusPath: undefined,
        plusPath: undefined,
        renameFrom: null,
        renameTo: null,
        isNew: false,
        isDeleted: false,
        binary: false,
        hunks: [],
      };
      i++;
      continue;
    }

    if (!block) {
      throw new GitError(`Unexpected line before the first "diff --git" header: ${line}`);
    }

    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      const oldStart = Number(hunkMatch[1]);
      const oldLines = hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]);
      const newStart = Number(hunkMatch[3]);
      const newLines = hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]);
      const hunkLines: DiffLine[] = [];
      let oldNo = oldStart;
      let newNo = newStart;
      let oldLeft = oldLines;
      let newLeft = newLines;
      i++;

      while (i < lines.length && (oldLeft > 0 || newLeft > 0 || lines[i].startsWith("\\"))) {
        const raw = lines[i];
        const marker = raw[0];
        const text = stripCr(raw.slice(1));
        if (marker === " ") {
          hunkLines.push({ type: "context", oldNo, newNo, text });
          oldNo++;
          newNo++;
          oldLeft--;
          newLeft--;
        } else if (marker === "-") {
          hunkLines.push({ type: "del", oldNo, newNo: null, text });
          oldNo++;
          oldLeft--;
        } else if (marker === "+") {
          hunkLines.push({ type: "add", oldNo: null, newNo, text });
          newNo++;
          newLeft--;
        } else if (marker !== "\\") {
          throw new GitError(`Malformed hunk in the diff of ${block.headerLine}: unexpected line "${raw}".`);
        }
        i++;
      }
      if (oldLeft !== 0 || newLeft !== 0) {
        throw new GitError(`Truncated hunk "${line}" in the diff of ${block.headerLine}.`);
      }
      block.hunks.push({ header: line, oldStart, oldLines, newStart, newLines, lines: hunkLines });
      continue;
    }

    if (line.startsWith("--- ")) block.minusPath = readPathField(line.slice(4), "a/");
    else if (line.startsWith("+++ ")) block.plusPath = readPathField(line.slice(4), "b/");
    else if (line.startsWith("rename from ")) block.renameFrom = readPathField(line.slice(12), null);
    else if (line.startsWith("rename to ")) block.renameTo = readPathField(line.slice(10), null);
    else if (line.startsWith("new file mode ")) block.isNew = true;
    else if (line.startsWith("deleted file mode ")) block.isDeleted = true;
    else if (line.startsWith("Binary files ") || line === "GIT binary patch") block.binary = true;
    i++;
  }

  if (block) files.push(finish(block));
  return files;
}
