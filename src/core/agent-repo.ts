/**
 * Accès au dépôt placé sur la machine de l'agent, quand ce serveur tourne derrière
 * mcp-http-gateway : chaque commande est exécutée par le relais agent (voir
 * gateway-exec.ts), dans `repoPath`, et sa sortie revient dans le rappel de l'outil.
 *
 * - git lit le dépôt ; `node` lit les fichiers de la copie de travail.
 * - La sortie d'une commande est limitée à 1 Mio par le relais : le diff est demandé
 *   fichier par fichier, et un contenu tronqué est rendu `null`.
 * - Les commandes d'une même demande sont groupées par paquets de STEPS_PER_ROUND, pour
 *   borner la taille de chaque rappel.
 */
import path from "path";
import { toPosixPath } from "./diff-parser.js";
import { GitError } from "./errors.js";
import { DIFF_ARGS, assertRefShape, type RepoAccess } from "./git.js";
import { RELAY_MAX_OUTPUT_BYTES, isTruncated, type ExecStep, type Run, type StepResult } from "./gateway-exec.js";

/** Nombre maximal de commandes par demande d'exécution. */
const STEPS_PER_ROUND = 25;

/** Variable d'environnement qui porte le chemin du fichier à lire. */
const FILE_ENV = "FEATURE_ANALYZER_FILE";

/** Écrit sur stdout le contenu du fichier FILE_ENV, ou la cible POSIX d'un lien symbolique. */
const READ_FILE_SCRIPT = [
  'const fs = require("fs");',
  `const file = process.env.${FILE_ENV};`,
  "process.stdout.write(fs.lstatSync(file).isSymbolicLink()",
  '  ? fs.readlinkSync(file).split(String.fromCharCode(92)).join("/")',
  "  : fs.readFileSync(file));",
].join("\n");

const MIB = `${RELAY_MAX_OUTPUT_BYTES / (1024 * 1024)} MiB`;

function detail(result: StepResult): string {
  return (result.error ?? (result.stderr.trim() || result.stdout.trim())) || "no output";
}

/** Accès au dépôt `repoPath` de la machine de l'agent, par les commandes que `run` y fait exécuter. */
export function agentRepo(repoPath: string, run: Run): RepoAccess {
  function gitStep(args: string[]): ExecStep {
    return {
      command: "git",
      args: ["-c", "core.quotepath=false", ...args],
      cwd: repoPath,
      env: { GIT_LITERAL_PATHSPECS: "1", GIT_TERMINAL_PROMPT: "0" },
    };
  }

  function readFileStep(filePath: string): ExecStep {
    return {
      command: "node",
      args: ["--input-type=commonjs", "-e", READ_FILE_SCRIPT],
      cwd: repoPath,
      env: { [FILE_ENV]: filePath },
    };
  }

  /** Échec de lancement d'une commande : dossier absent ou exécutable introuvable. */
  function launchError(step: ExecStep, result: StepResult): GitError {
    return new GitError(
      `Could not run ${step.command} in "${repoPath}" on the agent's machine (${result.error}). ` +
        `Check that repo_path exists on that machine and that ${step.command} is on its PATH.`
    );
  }

  /** Exécute une seule commande et rend son résultat ; un échec de lancement lève une erreur. */
  async function runOne(step: ExecStep): Promise<StepResult> {
    const [result] = await run([step]);
    if (!result) throw new GitError(`The agent relay returned no result for ${step.command} ${step.args.join(" ")}.`);
    if (result.error !== undefined) throw launchError(step, result);
    return result;
  }

  /** Exécute une commande git qui doit réussir, avec une sortie complète. */
  async function runGit(args: string[]): Promise<string> {
    const result = await runOne(gitStep(args));
    if (result.code !== 0) throw new GitError(`git ${args.join(" ")} failed in ${repoPath} on the agent's machine: ${detail(result)}`);
    if (isTruncated(result.stdout)) {
      throw new GitError(`The output of git ${args.join(" ")} exceeds ${MIB}, the output limit of the agent relay.`);
    }
    return result.stdout;
  }

  /**
   * Exécute une commande par élément, par paquets. Le relais s'arrête à la première
   * commande en échec : `onFailure` rend l'erreur à lever pour cet élément.
   */
  async function runEach<T>(
    items: T[],
    toStep: (item: T) => ExecStep,
    onFailure: (item: T, result: StepResult) => Error
  ): Promise<StepResult[]> {
    const all: StepResult[] = [];
    for (let start = 0; start < items.length; start += STEPS_PER_ROUND) {
      const chunk = items.slice(start, start + STEPS_PER_ROUND);
      const steps = chunk.map(toStep);
      const results = await run(steps);
      chunk.forEach((item, index) => {
        const result = results[index];
        if (!result) throw new GitError(`The agent relay returned no result for ${steps[index].command} ${steps[index].args.join(" ")}.`);
        if (result.error !== undefined) throw launchError(steps[index], result);
        if (result.code !== 0) throw onFailure(item, result);
        all.push(result);
      });
    }
    return all;
  }

  /** Contenu rendu par le relais, ou null s'il a été tronqué. */
  function contentOf(result: StepResult): Buffer | null {
    return isTruncated(result.stdout) ? null : Buffer.from(result.stdout, "utf-8");
  }

  return {
    async assertRepoRoot() {
      if (!path.posix.isAbsolute(repoPath) && !path.win32.isAbsolute(repoPath)) {
        throw new GitError(`repo_path must be an absolute path on the agent's machine, got "${repoPath}".`);
      }
      const args = ["rev-parse", "--show-toplevel", "--show-cdup"];
      const result = await runOne(gitStep(args));
      if (result.code !== 0) {
        if (/not a git repository/i.test(result.stderr)) {
          throw new GitError(`repo_path "${repoPath}" is not inside a git repository.`);
        }
        throw new GitError(`git ${args.join(" ")} failed in ${repoPath} on the agent's machine: ${detail(result)}`);
      }
      const [topLevel, cdup] = result.stdout.split("\n");
      if (cdup.trim() !== "") {
        throw new GitError(
          `repo_path "${repoPath}" is not the root of its git repository. Use the repository root: ${topLevel.trim()}`
        );
      }
    },

    async resolveCommit(ref, role) {
      assertRefShape(ref, role);
      const result = await runOne(gitStep(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]));
      if (result.code !== 0) {
        throw new GitError(
          `Unknown ${role} ref "${ref}" in ${repoPath}. Use a branch name, a tag or a commit sha that exists in this repository.`
        );
      }
      return result.stdout.trim();
    },

    async diff(range) {
      const listing = await runGit([
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-relative",
        "--find-renames",
        "--name-status",
        "-z",
        ...range,
        "--",
      ]);
      const tokens = listing.split("\0");
      const files: string[][] = [];
      for (let index = 0; index < tokens.length && tokens[index] !== ""; ) {
        const pathCount = /^[RC]/.test(tokens[index]) ? 2 : 1;
        files.push(tokens.slice(index + 1, index + 1 + pathCount));
        index += 1 + pathCount;
      }

      const results = await runEach(
        files,
        (paths) => gitStep([...DIFF_ARGS, ...range, "--", ...paths]),
        (paths, result) => new GitError(`git diff of "${paths.join('" -> "')}" failed on the agent's machine: ${detail(result)}`)
      );
      return results
        .map((result, index) => {
          if (isTruncated(result.stdout)) {
            throw new GitError(
              `The diff of "${files[index].at(-1)}" exceeds ${MIB}, the output limit of the agent relay: this change cannot be analysed through the gateway.`
            );
          }
          return result.stdout;
        })
        .join("");
    },

    async readCommitFiles(commit, paths) {
      const results = await runEach(
        paths,
        (filePath) => gitStep(["cat-file", "blob", `${commit}:${filePath}`]),
        (filePath) => new GitError(`"${filePath}" is in the diff but is not a file of commit ${commit} (submodule or unreadable entry).`)
      );
      return new Map(paths.map((filePath, index) => [filePath, contentOf(results[index])]));
    },

    async untrackedFiles() {
      return (await runGit(["ls-files", "--others", "--exclude-standard", "-z"]))
        .split("\0")
        .filter((entry) => entry !== "")
        .map(toPosixPath);
    },

    async readWorkingFiles(paths) {
      const results = await runEach(
        paths,
        readFileStep,
        (filePath, result) => new GitError(`Could not read "${filePath}" in ${repoPath} on the agent's machine: ${detail(result)}`)
      );
      return new Map(paths.map((filePath, index) => [filePath, contentOf(results[index])]));
    },
  };
}
