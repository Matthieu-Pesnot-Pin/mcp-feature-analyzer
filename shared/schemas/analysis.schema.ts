import { z } from "zod";

export const ANALYSIS_MODES = ["branch", "working_tree"] as const;
export const FILE_STATUSES = ["added", "modified", "deleted", "renamed"] as const;
export const SEVERITIES = ["critical", "major", "minor", "trivial"] as const;
export const FINDING_KINDS = ["issue", "requirement_gap"] as const;
export const FINDING_STATUSES = ["open", "ignored", "outdated"] as const;
export const DIAGRAM_KINDS = ["flow", "layers", "mindmap"] as const;
export const NODE_SHAPES = ["box", "pill", "decision"] as const;
export const NODE_STATUSES = ["new", "modified", "impacted", "existing", "finding", "missing"] as const;
export const REVIEW_STATES = ["pending", "submitted"] as const;
export const REVIEW_DECISIONS = ["approve", "request_changes", "reject"] as const;
export const EDITORS = ["agent", "user"] as const;

/** Identifiant d'analyse : slug en minuscules, sert aussi de nom de fichier. */
export const ANALYSIS_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Identifiant d'un constat, d'une remarque, d'un schéma ou d'un nœud. */
export const ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const ItemIdSchema = z
  .string()
  .regex(ITEM_ID_PATTERN, "must contain only letters, digits, '_' or '-' (1 to 64 characters)");

const LineSchema = z.number().int().positive();
const IsoDateSchema = z.string().min(1);

/** Fichier modifié par la feature, tel que figé au dernier snapshot. */
export const FileEntrySchema = z.object({
  path: z.string().min(1),
  oldPath: z.string().min(1).nullable(),
  status: z.enum(FILE_STATUSES),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  binary: z.boolean(),
  /** Vrai quand le texte du côté « nouveau » est conservé dans le snapshot. */
  contentAvailable: z.boolean(),
  /** Nombre de lignes du côté « nouveau » ; 0 quand le contenu n'est pas disponible. */
  lineCount: z.number().int().nonnegative(),
  reviewed: z.boolean(),
});

/** Plage de lignes du côté « nouveau » du diff, bornes incluses. */
export const FindingLocationSchema = z.object({
  path: z.string().min(1),
  startLine: LineSchema,
  endLine: LineSchema,
});

export const FindingSchema = z.object({
  id: ItemIdSchema,
  severity: z.enum(SEVERITIES),
  kind: z.enum(FINDING_KINDS),
  title: z.string().min(1),
  body: z.string(),
  location: FindingLocationSchema.nullable(),
  /** Texte exact des lignes visées au moment où le constat a été ancré. */
  anchorText: z.string().nullable(),
  /** Texte de remplacement proposé pour les lignes visées. */
  suggestion: z.string().nullable(),
  /** Prompt fourni par l'agent ; remplace le corps généré dans le retour. */
  prompt: z.string().nullable(),
  status: z.enum(FINDING_STATUSES),
  createdAt: IsoDateSchema,
});

/** Emplacement d'une remarque : une ligne du côté « nouveau », ou le fichier entier (`line` null). */
export const NoteLocationSchema = z.object({
  path: z.string().min(1),
  line: LineSchema.nullable(),
});

export const NoteSchema = z.object({
  id: ItemIdSchema,
  location: NoteLocationSchema.nullable(),
  text: z.string().min(1),
  createdAt: IsoDateSchema,
});

export const DiagramNodeLocationSchema = z.object({
  path: z.string().min(1),
  line: LineSchema.nullable(),
});

export const DiagramNodeSchema = z.object({
  id: ItemIdSchema,
  label: z.string().min(1),
  shape: z.enum(NODE_SHAPES),
  status: z.enum(NODE_STATUSES),
  layer: z.string().min(1).nullable(),
  detail: z.string().nullable(),
  location: DiagramNodeLocationSchema.nullable(),
});

export const DiagramLinkSchema = z.object({
  from: ItemIdSchema,
  to: ItemIdSchema,
  label: z.string().nullable(),
});

export const DiagramSchema = z.object({
  id: ItemIdSchema,
  title: z.string().min(1),
  kind: z.enum(DIAGRAM_KINDS),
  /** Ordre des colonnes quand `kind` vaut `layers`. */
  layers: z.array(z.string().min(1)),
  nodes: z.array(DiagramNodeSchema),
  links: z.array(DiagramLinkSchema),
  updatedAt: IsoDateSchema,
});

export const ReviewSchema = z.object({
  state: z.enum(REVIEW_STATES),
  decision: z.enum(REVIEW_DECISIONS).nullable(),
  selectedFindingIds: z.array(ItemIdSchema),
  selectedNoteIds: z.array(ItemIdSchema),
  prompt: z.string().nullable(),
  submittedAt: IsoDateSchema.nullable(),
});

export const RequestSchema = z.object({
  text: z.string().min(1),
  source: z.string().min(1).nullable(),
});

/** Vue d'ensemble de la feature : objectif, approche et points d'attention pour le relecteur. */
export const OverviewSchema = z.object({
  /** Ce que la feature doit permettre, du point de vue fonctionnel. */
  objective: z.string().min(1),
  /** Comment elle y parvient : choix d'architecture, flux principal. */
  approach: z.string().min(1),
  /** Risques et points à vérifier en priorité. */
  attentionPoints: z.array(z.string().min(1)),
});

/** Nom de projet : non vide, sans espace en tête ni en fin. */
export const ProjectNameSchema = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), "must not start or end with whitespace");

export const AnalysisSchema = z.object({
  id: z.string().regex(ANALYSIS_ID_PATTERN),
  title: z.string().min(1),
  /** Projet ou feature auquel l'analyse appartient ; sert de dossier de rangement. */
  project: ProjectNameSchema,
  repoPath: z.string().min(1),
  mode: z.enum(ANALYSIS_MODES),
  /** Ref de base en mode `branch` ; "HEAD" en mode `working_tree`. */
  base: z.string().min(1),
  /** Ref de tête en mode `branch` ; null en mode `working_tree`. */
  head: z.string().min(1).nullable(),
  baseCommit: z.string().min(1),
  headCommit: z.string().min(1).nullable(),
  snapshotAt: IsoDateSchema,
  request: RequestSchema.nullable(),
  overview: OverviewSchema.nullable(),
  /** Changements fonctionnels de la feature, une puce par changement. */
  summary: z.array(z.string().min(1)),
  files: z.array(FileEntrySchema),
  findings: z.array(FindingSchema),
  notes: z.array(NoteSchema),
  diagrams: z.array(DiagramSchema),
  review: ReviewSchema,
  revision: z.number().int().nonnegative(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  lastEditor: z.enum(EDITORS),
});

export type AnalysisMode = (typeof ANALYSIS_MODES)[number];
export type FileStatus = (typeof FILE_STATUSES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type FindingKind = (typeof FINDING_KINDS)[number];
export type FindingStatus = (typeof FINDING_STATUSES)[number];
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];
export type NodeShape = (typeof NODE_SHAPES)[number];
export type NodeStatus = (typeof NODE_STATUSES)[number];
export type ReviewState = (typeof REVIEW_STATES)[number];
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export type Editor = (typeof EDITORS)[number];

export type FileEntry = z.infer<typeof FileEntrySchema>;
export type FindingLocation = z.infer<typeof FindingLocationSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type NoteLocation = z.infer<typeof NoteLocationSchema>;
export type Note = z.infer<typeof NoteSchema>;
export type DiagramNodeLocation = z.infer<typeof DiagramNodeLocationSchema>;
export type DiagramNode = z.infer<typeof DiagramNodeSchema>;
export type DiagramLink = z.infer<typeof DiagramLinkSchema>;
export type Diagram = z.infer<typeof DiagramSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type AnalysisRequest = z.infer<typeof RequestSchema>;
export type Overview = z.infer<typeof OverviewSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;

/** État d'avancement d'une revue, dérivé des fichiers revus et de la soumission. */
export const REVIEW_PROGRESS_STATES = ["not_started", "in_progress", "files_reviewed", "submitted"] as const;
export type ReviewProgressState = (typeof REVIEW_PROGRESS_STATES)[number];

/** Avancement d'une revue (voir `reviewProgress` dans `shared/review-state.ts`). */
export interface ReviewProgress {
  state: ReviewProgressState;
  reviewedFiles: number;
  totalFiles: number;
  /** Décision de la revue soumise ; null tant qu'elle ne l'est pas. */
  decision: ReviewDecision | null;
}

/** Vue légère d'une analyse, pour les listes. */
export interface AnalysisSummary {
  id: string;
  title: string;
  project: string;
  mode: AnalysisMode;
  base: string;
  head: string | null;
  fileCount: number;
  reviewedCount: number;
  /** Constats au statut `open`, par gravité. */
  openFindings: Record<Severity, number>;
  diagramCount: number;
  progress: ReviewProgress;
  updatedAt: string;
  revision: number;
}
