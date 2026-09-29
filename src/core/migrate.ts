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

/** Étapes appliquées aux analyses (`analyses/<id>.json`), dans l'ordre. */
export const ANALYSIS_MIGRATIONS: readonly MigrationStep[] = [addProject, addOverview];

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
