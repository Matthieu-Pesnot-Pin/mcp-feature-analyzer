import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  ANALYSIS_ID_PATTERN,
  AnalysisSchema,
  type Analysis,
  type AnalysisRequest,
  type AnalysisSummary,
  type Editor,
} from "../../shared/schemas/analysis.schema.js";
import { DiffSnapshotSchema, type DiffSnapshot } from "../../shared/schemas/diff.schema.js";
import { emptySeverityCounts } from "../../shared/severity.js";
import { AnalysisError } from "./errors.js";
import type { ComputedSnapshot } from "./git.js";
import { analysisId } from "./ids.js";
import { assertInvariants, assertSnapshotFieldsUnchanged } from "./invariants.js";
import { migrateAnalysis, migrateSnapshot, type RawDocument } from "./migrate.js";
import { applyRefresh, type RefreshStats } from "./refresh.js";

export interface CreateAnalysisInput {
  title: string;
  request?: AnalysisRequest | null;
  summary?: string[];
}

export interface MutateOptions {
  /**
   * Révision sur laquelle la modification est basée. Quand elle est fournie et
   * que l'analyse a avancé depuis, l'écriture est refusée.
   */
  baseRevision?: number;
}

/** Résultat de `list` : les analyses lisibles et les fichiers qui ne le sont pas. */
export interface AnalysisListing {
  analyses: AnalysisSummary[];
  unreadable: Array<{ id: string; error: string }>;
}

export interface ReplaceSnapshotResult {
  analysis: Analysis;
  stats: RefreshStats;
}

/** Signature de fichier servant à détecter l'écriture d'un autre processus. */
interface FileStamp {
  mtimeMs: number;
  size: number;
}

interface CacheEntry<T> {
  value: T;
  stamp: FileStamp;
}

/** Au-delà de ce délai, un verrou est réputé abandonné par un processus arrêté en cours d'écriture. */
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;

/** Pause bloquante : le store est synchrone de bout en bout. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function formatIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"} ${issue.message}`).join("; ");
}

function stampOf(file: string): FileStamp | null {
  try {
    const stat = fs.statSync(file);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/** Écriture atomique : fichier temporaire unique puis `rename`, JSON indenté. */
function writeJsonAtomic(target: string, value: unknown): void {
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Persistance des analyses : `<dataDir>/analyses/<id>.json` pour l'analyse et
 * `<dataDir>/diffs/<id>.json` pour son snapshot de diff. Plusieurs processus
 * peuvent partager le même répertoire : chaque cycle lire-modifier-écrire est
 * sérialisé par un verrou fichier, et le cache mémoire est invalidé dès que la
 * signature (mtime, taille) du fichier change.
 */
export class AnalysisStore {
  readonly dataDir: string;
  private readonly analysesDir: string;
  private readonly diffsDir: string;
  private readonly analysisCache = new Map<string, CacheEntry<Analysis>>();
  private readonly snapshotCache = new Map<string, CacheEntry<DiffSnapshot>>();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.analysesDir = path.join(dataDir, "analyses");
    this.diffsDir = path.join(dataDir, "diffs");
    fs.mkdirSync(this.analysesDir, { recursive: true });
    fs.mkdirSync(this.diffsDir, { recursive: true });
  }

  analysisPath(id: string): string {
    return path.join(this.analysesDir, `${id}.json`);
  }

  snapshotPath(id: string): string {
    return path.join(this.diffsDir, `${id}.json`);
  }

  /** Refuse un identifiant qui ne peut pas désigner une analyse (et donc un nom de fichier). */
  private assertId(id: string): void {
    if (typeof id !== "string" || !ANALYSIS_ID_PATTERN.test(id)) {
      throw new AnalysisError(`"${id}" is not a valid analysis id. Use list_analyses to see the available analyses.`);
    }
  }

  private notFound(id: string): AnalysisError {
    return new AnalysisError(`Analysis "${id}" not found. Use list_analyses to see the available analyses.`);
  }

  /**
   * Sérialise l'accès en écriture à une analyse entre processus : `wx` échoue si
   * le verrou existe déjà. Non réentrant.
   */
  private withLock<T>(id: string, fn: () => T): T {
    const lockPath = `${this.analysisPath(id)}.lock`;
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    let fd: number;

    for (;;) {
      try {
        fd = fs.openSync(lockPath, "wx");
        break;
      } catch (err: any) {
        if (err.code !== "EEXIST") throw err;
        const lockStamp = stampOf(lockPath);
        // Verrou disparu entre l'ouverture et la lecture de sa date : nouvel essai immédiat.
        if (lockStamp === null) continue;
        if (Date.now() - lockStamp.mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
        if (Date.now() > deadline) {
          throw new AnalysisError(
            `Analysis "${id}" is being written by another editor and did not free up in ${LOCK_TIMEOUT_MS} ms. Try again in a moment.`
          );
        }
        sleepSync(LOCK_RETRY_MS);
      }
    }

    try {
      return fn();
    } finally {
      fs.closeSync(fd);
      // Le verrou a pu être cassé pour obsolescence par un autre processus.
      fs.rmSync(lockPath, { force: true });
    }
  }

  /**
   * Lit, migre et valide un document JSON. Un document migré est réécrit sur
   * disque. `parse` renvoie le document typé ou lève une erreur. Renvoie null
   * si le fichier n'existe pas.
   */
  private readDocument<T>(
    file: string,
    label: string,
    cache: Map<string, CacheEntry<T>>,
    id: string,
    migrate: (raw: unknown) => RawDocument | null,
    parse: (raw: unknown) => T
  ): T | null {
    const stamp = stampOf(file);
    if (stamp === null) {
      cache.delete(id);
      return null;
    }
    const cached = cache.get(id);
    if (cached && cached.stamp.mtimeMs === stamp.mtimeMs && cached.stamp.size === stamp.size) {
      return cached.value;
    }
    cache.delete(id);

    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (err: any) {
      throw new AnalysisError(`${label} is not readable (${file}): ${err.message}`);
    }
    const migrated = migrate(raw);
    const value = parse(migrated ?? raw);
    if (migrated) writeJsonAtomic(file, value);
    const fresh = stampOf(file);
    if (fresh) cache.set(id, { value, stamp: fresh });
    return value;
  }

  private parseAnalysis(id: string, raw: unknown): Analysis {
    const parsed = AnalysisSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AnalysisError(
        `Analysis "${id}" does not match the expected schema (${this.analysisPath(id)}): ${formatIssues(parsed.error.issues)}`
      );
    }
    if (parsed.data.id !== id) {
      throw new AnalysisError(`Analysis file ${this.analysisPath(id)} contains the id "${parsed.data.id}" instead of "${id}".`);
    }
    return parsed.data;
  }

  private parseSnapshot(id: string, raw: unknown): DiffSnapshot {
    const parsed = DiffSnapshotSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AnalysisError(
        `Diff snapshot of analysis "${id}" does not match the expected schema (${this.snapshotPath(id)}): ${formatIssues(parsed.error.issues)}`
      );
    }
    if (parsed.data.analysisId !== id) {
      throw new AnalysisError(
        `Diff snapshot ${this.snapshotPath(id)} belongs to analysis "${parsed.data.analysisId}" instead of "${id}".`
      );
    }
    return parsed.data;
  }

  private writeAnalysis(analysis: Analysis): void {
    const file = this.analysisPath(analysis.id);
    writeJsonAtomic(file, analysis);
    const stamp = stampOf(file);
    if (stamp) this.analysisCache.set(analysis.id, { value: analysis, stamp });
  }

  private writeSnapshot(snapshot: DiffSnapshot): void {
    const file = this.snapshotPath(snapshot.analysisId);
    writeJsonAtomic(file, snapshot);
    const stamp = stampOf(file);
    if (stamp) this.snapshotCache.set(snapshot.analysisId, { value: snapshot, stamp });
  }

  /** Valide une analyse complète (schéma puis invariants) avant écriture. */
  private validate(analysis: Analysis): Analysis {
    const parsed = AnalysisSchema.safeParse(analysis);
    if (!parsed.success) {
      throw new AnalysisError(`Resulting analysis is invalid: ${formatIssues(parsed.error.issues)}`);
    }
    assertInvariants(parsed.data);
    return parsed.data;
  }

  has(id: string): boolean {
    return ANALYSIS_ID_PATTERN.test(id) && fs.existsSync(this.analysisPath(id));
  }

  /** Résumés des analyses, de la plus récemment modifiée à la plus ancienne. */
  list(): AnalysisListing {
    const analyses: AnalysisSummary[] = [];
    const unreadable: AnalysisListing["unreadable"] = [];
    const ids = fs
      .readdirSync(this.analysesDir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -".json".length));

    for (const id of ids) {
      let analysis: Analysis;
      try {
        this.assertId(id);
        analysis = this.get(id);
      } catch (err) {
        unreadable.push({ id, error: (err as Error).message });
        continue;
      }
      analyses.push(summarize(analysis));
    }
    analyses.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { analyses, unreadable };
  }

  get(id: string): Analysis {
    this.assertId(id);
    const analysis = this.readDocument(
      this.analysisPath(id),
      `Analysis "${id}"`,
      this.analysisCache,
      id,
      migrateAnalysis,
      (raw) => this.parseAnalysis(id, raw)
    );
    if (analysis === null) throw this.notFound(id);
    return analysis;
  }

  getSnapshot(id: string): DiffSnapshot {
    this.assertId(id);
    if (!fs.existsSync(this.analysisPath(id))) throw this.notFound(id);
    const snapshot = this.readDocument(
      this.snapshotPath(id),
      `Diff snapshot of analysis "${id}"`,
      this.snapshotCache,
      id,
      migrateSnapshot,
      (raw) => this.parseSnapshot(id, raw)
    );
    if (snapshot === null) {
      throw new AnalysisError(
        `Diff snapshot of analysis "${id}" is missing (${this.snapshotPath(id)}). ` +
          `Delete the analysis with delete_analysis and create it again.`
      );
    }
    return snapshot;
  }

  /** Crée une analyse à partir d'un snapshot calculé ; le snapshot est écrit avant l'analyse. */
  create(input: CreateAnalysisInput, snapshot: ComputedSnapshot): Analysis {
    const title = input.title?.trim();
    if (!title) throw new AnalysisError(`"title" is required to create an analysis.`);

    let id = analysisId(title);
    while (fs.existsSync(this.analysisPath(id))) id = analysisId(title);

    const now = new Date().toISOString();
    const analysis = this.validate({
      id,
      title,
      repoPath: snapshot.repoPath,
      mode: snapshot.mode,
      base: snapshot.base,
      head: snapshot.head,
      baseCommit: snapshot.baseCommit,
      headCommit: snapshot.headCommit,
      snapshotAt: snapshot.snapshotAt,
      request: input.request ?? null,
      summary: input.summary ?? [],
      files: snapshot.files.map((file) => ({ ...file, reviewed: false })),
      findings: [],
      notes: [],
      diagrams: [],
      review: {
        state: "pending",
        decision: null,
        selectedFindingIds: [],
        selectedNoteIds: [],
        prompt: null,
        submittedAt: null,
      },
      revision: 0,
      createdAt: now,
      updatedAt: now,
      lastEditor: "agent",
    });
    const diff = this.buildSnapshot(id, snapshot);

    return this.withLock(id, () => {
      this.writeSnapshot(diff);
      this.writeAnalysis(analysis);
      return analysis;
    });
  }

  private buildSnapshot(id: string, snapshot: ComputedSnapshot): DiffSnapshot {
    const parsed = DiffSnapshotSchema.safeParse({ analysisId: id, files: snapshot.diff });
    if (!parsed.success) {
      throw new AnalysisError(`Computed diff snapshot is invalid: ${formatIssues(parsed.error.issues)}`);
    }
    const diffPaths = parsed.data.files.map((file) => file.path).join("\n");
    const entryPaths = snapshot.files.map((file) => file.path).join("\n");
    if (diffPaths !== entryPaths) {
      throw new AnalysisError(`Computed snapshot is inconsistent: its file list and its diff list differ.`);
    }
    return parsed.data;
  }

  /**
   * Point unique de modification : applique `fn` à une copie de l'analyse,
   * vérifie schéma et invariants, incrémente la révision puis écrit. Les champs
   * issus du snapshot ne peuvent pas changer ici (voir `replaceSnapshot`).
   */
  mutate(id: string, editor: Editor, fn: (draft: Analysis) => void, options: MutateOptions = {}): Analysis {
    this.assertId(id);
    return this.withLock(id, () => {
      const current = this.get(id);
      this.assertBaseRevision(current, options);

      const draft = structuredClone(current);
      fn(draft);
      assertSnapshotFieldsUnchanged(current, draft);
      draft.revision = current.revision + 1;
      draft.updatedAt = new Date().toISOString();
      draft.lastEditor = editor;

      const next = this.validate(draft);
      this.writeAnalysis(next);
      return next;
    });
  }

  private assertBaseRevision(current: Analysis, options: MutateOptions): void {
    if (options.baseRevision !== undefined && options.baseRevision !== current.revision) {
      throw new AnalysisError(
        `Analysis "${current.id}" has changed since it was loaded: the edit is based on revision ${options.baseRevision}, ` +
          `the stored analysis is at revision ${current.revision}. Reload it and apply the change again.`
      );
    }
  }

  /**
   * Remplace le snapshot de diff d'une analyse par `snapshot`, recalculé avec
   * les mêmes dépôt, mode et refs, et met à jour fichiers et constats selon
   * `applyRefresh`.
   */
  replaceSnapshot(id: string, editor: Editor, snapshot: ComputedSnapshot, options: MutateOptions = {}): ReplaceSnapshotResult {
    this.assertId(id);
    return this.withLock(id, () => {
      const current = this.get(id);
      this.assertBaseRevision(current, options);
      const oldSnapshot = this.getSnapshot(id);

      const { fields, stats } = applyRefresh(current, oldSnapshot, snapshot);
      const next = this.validate({
        ...structuredClone(current),
        ...fields,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
        lastEditor: editor,
      });
      const diff = this.buildSnapshot(id, snapshot);

      this.writeSnapshot(diff);
      this.writeAnalysis(next);
      return { analysis: next, stats };
    });
  }

  /** Supprime l'analyse et son snapshot de diff. */
  delete(id: string): void {
    this.assertId(id);
    this.withLock(id, () => {
      if (!fs.existsSync(this.analysisPath(id))) throw this.notFound(id);
      fs.rmSync(this.analysisPath(id));
      fs.rmSync(this.snapshotPath(id), { force: true });
      this.analysisCache.delete(id);
      this.snapshotCache.delete(id);
    });
  }
}

/** Vue légère d'une analyse. */
export function summarize(analysis: Analysis): AnalysisSummary {
  const openFindings = emptySeverityCounts();
  for (const finding of analysis.findings) {
    if (finding.status === "open") openFindings[finding.severity]++;
  }
  return {
    id: analysis.id,
    title: analysis.title,
    mode: analysis.mode,
    base: analysis.base,
    head: analysis.head,
    fileCount: analysis.files.length,
    reviewedCount: analysis.files.filter((file) => file.reviewed).length,
    openFindings,
    diagramCount: analysis.diagrams.length,
    reviewState: analysis.review.state,
    decision: analysis.review.decision,
    updatedAt: analysis.updatedAt,
    revision: analysis.revision,
  };
}
