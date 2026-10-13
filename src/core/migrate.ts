/**
 * Mises à niveau des fichiers de données, appliquées à la lecture avant la
 * validation de schéma. Chaque étape est idempotente : elle renvoie null quand
 * le document est déjà dans le format qu'elle produit.
 */

import { AnalysisError } from "./errors.js";

export type RawDocument = Record<string, unknown>;

/** Étape de migration : document mis à niveau, ou null si elle n'a rien à changer. */
export type MigrationStep = (raw: RawDocument) => RawDocument | null;

/** Dernier segment d'un chemin POSIX ou Windows, séparateurs finaux ignorés ; chaîne vide pour une racine. */
export function repoFolderName(repoPath: string): string {
  const parts = repoPath.split(/[\\/]+/).filter((part) => part !== "");
  const last = parts[parts.length - 1] ?? "";
  return /^[A-Za-z]:$/.test(last) ? "" : last.trim();
}

/** Ajoute `project` : le nom du dossier du dépôt (`basename(repoPath)`). */
export const addProject: MigrationStep = (doc) => {
  if (doc.project !== undefined) return null;
  const repoPath = doc.repoPath;
  const project = typeof repoPath === "string" ? repoFolderName(repoPath) : "";
  if (project === "") {
    throw new AnalysisError(
      `Cannot derive the project of analysis "${String(doc.id)}" from its repoPath ${JSON.stringify(repoPath)}: ` +
        `set "project" in the analysis file, or delete the analysis with delete_analysis and create it again.`
    );
  }
  return { ...doc, project };
};

/** Ajoute `overview` à null : l'analyse n'a pas encore de vue d'ensemble. */
export const addOverview: MigrationStep = (doc) => (doc.overview !== undefined ? null : { ...doc, overview: null });

/** Ajoute `explanations` vide : l'analyse n'a pas encore d'explication. */
export const addExplanations: MigrationStep = (doc) => (doc.explanations !== undefined ? null : { ...doc, explanations: [] });

/** Ajoute `findingId` à null sur les remarques qui n'en ont pas : elles restent des remarques libres. */
export const addNoteFindingIds: MigrationStep = (doc) => {
  if (!Array.isArray(doc.notes)) return null;
  const notes = doc.notes as unknown[];
  const missing = (note: unknown) => !!note && typeof note === "object" && (note as RawDocument).findingId === undefined;
  if (!notes.some(missing)) return null;
  return { ...doc, notes: notes.map((note) => (missing(note) ? { ...(note as RawDocument), findingId: null } : note)) };
};

/**
 * Ajoute à la revue `processed` et `previousSubmission` à null : une revue soumise
 * avant ce format est à traiter, sans version précédente.
 */
export const addReviewProcessing: MigrationStep = (doc) => {
  const review = doc.review;
  if (!review || typeof review !== "object" || Array.isArray(review)) return null;
  const raw = review as RawDocument;
  if (raw.processed !== undefined && raw.previousSubmission !== undefined) return null;
  return { ...doc, review: { ...raw, processed: raw.processed ?? null, previousSubmission: raw.previousSubmission ?? null } };
};

/** `processed` augmenté de `by: "agent"` quand il n'a pas d'auteur ; null quand il n'y a rien à changer. */
function withProcessingAuthor(processed: unknown): RawDocument | null {
  if (!processed || typeof processed !== "object" || Array.isArray(processed)) return null;
  const raw = processed as RawDocument;
  return raw.by !== undefined ? null : { ...raw, by: "agent" };
}

/**
 * Ajoute `by: "agent"` aux traitements enregistrés sans auteur, dans la revue et
 * dans sa version soumise précédente : seul l'agent pouvait alors les poser.
 */
export const addProcessingAuthor: MigrationStep = (doc) => {
  const review = doc.review;
  if (!review || typeof review !== "object" || Array.isArray(review)) return null;
  const raw = review as RawDocument;
  const processed = withProcessingAuthor(raw.processed);
  const previous = raw.previousSubmission as RawDocument | null | undefined;
  const previousProcessed = previous && typeof previous === "object" ? withProcessingAuthor(previous.processed) : null;
  if (processed === null && previousProcessed === null) return null;
  return {
    ...doc,
    review: {
      ...raw,
      ...(processed === null ? {} : { processed }),
      ...(previousProcessed === null ? {} : { previousSubmission: { ...previous, processed: previousProcessed } }),
    },
  };
};

/** Ajoute `followUpOf` à null : l'analyse n'est la revue de suivi d'aucune autre. */
export const addFollowUpOf: MigrationStep = (doc) => (doc.followUpOf !== undefined ? null : { ...doc, followUpOf: null });

/** Étapes appliquées aux analyses (`analyses/<id>.json`), dans l'ordre. */
export const ANALYSIS_MIGRATIONS: readonly MigrationStep[] = [
  addProject,
  addOverview,
  addExplanations,
  addNoteFindingIds,
  addReviewProcessing,
  addProcessingAuthor,
  addFollowUpOf,
];

/** Étapes appliquées aux snapshots de diff (`diffs/<id>.json`), dans l'ordre. */
export const SNAPSHOT_MIGRATIONS: readonly MigrationStep[] = [];

/** Applique `steps` à la suite. Renvoie null si aucune étape n'a modifié le document. */
export function applyMigrations(raw: unknown, steps: readonly MigrationStep[]): RawDocument | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  let current = raw as RawDocument;
  let changed = false;
  for (const step of steps) {
    const next = step(current);
    if (next !== null) {
      current = next;
      changed = true;
    }
  }
  return changed ? current : null;
}

/** Met à niveau une analyse brute ; null si elle est déjà à jour. */
export function migrateAnalysis(raw: unknown): RawDocument | null {
  return applyMigrations(raw, ANALYSIS_MIGRATIONS);
}

/** Met à niveau un snapshot de diff brut ; null s'il est déjà à jour. */
export function migrateSnapshot(raw: unknown): RawDocument | null {
  return applyMigrations(raw, SNAPSHOT_MIGRATIONS);
}
