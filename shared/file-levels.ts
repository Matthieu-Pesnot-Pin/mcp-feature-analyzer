import { FILE_LEVELS, type Analysis, type FileEntry, type FileLevel } from "./schemas/analysis.schema.js";

/** Niveau retenu pour un fichier : celui du relecteur s'il en a choisi un, sinon celui de l'agent ; null sans classement. */
export function effectiveLevel(file: Pick<FileEntry, "classification">): FileLevel | null {
  const classification = file.classification;
  if (classification === null) return null;
  return classification.reviewerLevel ?? classification.level;
}

/** Rang d'un niveau dans l'ordre de relecture ; les fichiers non classés passent en dernier. */
function levelRank(level: FileLevel | null): number {
  return level === null ? FILE_LEVELS.length : FILE_LEVELS.indexOf(level);
}

/** Fichiers dans l'ordre de relecture : central, à vérifier, survol, puis non classés ; l'ordre du diff dans chaque niveau. */
export function filesInReviewOrder<T extends Pick<FileEntry, "classification">>(files: readonly T[]): T[] {
  return files
    .map((file, index) => ({ file, index, rank: levelRank(effectiveLevel(file)) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ file }) => file);
}

/** Vrai quand au moins un fichier de l'analyse est classé. */
export function hasClassification(analysis: Pick<Analysis, "files">): boolean {
  return analysis.files.some((file) => file.classification !== null);
}

/** Fichiers dont le relecteur a changé le niveau choisi par l'agent. */
export function reclassifiedFiles(analysis: Pick<Analysis, "files">): FileEntry[] {
  return analysis.files.filter((file) => file.classification !== null && file.classification.reviewerLevel !== null);
}

/**
 * Familles de fichiers courts aux conséquences lourdes, jamais classés en survol
 * par l'agent : migrations, SQL, configuration, intégration continue, conteneurs.
 */
const SENSITIVE_FILES: ReadonlyArray<{ kind: string; pattern: RegExp }> = [
  { kind: "migration", pattern: /(^|\/)migrations?\//i },
  { kind: "SQL file", pattern: /\.sql$/i },
  { kind: "CI workflow", pattern: /(^|\/)\.(github|gitlab)\/|(^|\/)\.gitlab-ci\.ya?ml$/i },
  { kind: "container file", pattern: /(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml)$/i },
  { kind: "environment file", pattern: /(^|\/)\.env(\.[^/]*)?$/i },
  {
    kind: "configuration file",
    pattern: /(^|\/)(config|settings)\/|(^|\/)(package\.json|tsconfig[^/]*\.json|[^/]+\.config\.[cm]?[jt]s|[^/]+\.(ya?ml|toml|ini|properties|conf))$/i,
  },
];

/** Famille sensible à laquelle appartient `path`, ou null. */
export function sensitiveFileKind(path: string): string | null {
  return SENSITIVE_FILES.find(({ pattern }) => pattern.test(path))?.kind ?? null;
}
