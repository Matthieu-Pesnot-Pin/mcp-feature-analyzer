import type { Analysis, FileEntry } from "./schemas/analysis.schema.js";
import type { DiffLine, Hunk } from "./schemas/diff.schema.js";
import { lineRange } from "./text.js";

const MARKERS: Record<DiffLine["type"], string> = { context: " ", add: "+", del: "-" };

function refsLabel(analysis: Analysis): string {
  if (analysis.mode === "branch") return `branch ${analysis.base}...${analysis.head}`;
  return "working tree changes against HEAD";
}

/** Plage `début-fin` d'un côté du bloc, ou null quand ce côté n'a aucune ligne. */
function sideRange(start: number, count: number): string | null {
  return count === 0 ? null : lineRange(start, start + count - 1);
}

/** Lignes du bloc au format de get_diff : `ancien | nouveau`, puis le marqueur et le texte. */
function hunkCode(hunk: Hunk): string[] {
  let width = 1;
  for (const line of hunk.lines) {
    width = Math.max(width, String(line.oldNo ?? "").length, String(line.newNo ?? "").length);
  }
  const column = (value: number | null) => String(value ?? "").padStart(width);
  return [hunk.header, ...hunk.lines.map((line) => `${column(line.oldNo)} | ${column(line.newNo)} ${MARKERS[line.type]} ${line.text}`)];
}

/**
 * Prompt qui demande à l'agent d'expliquer un bloc du diff et d'enregistrer ses
 * explications dans l'analyse : analyse, dépôt et refs, fichier, plages de lignes
 * des deux côtés, code du bloc tel que figé, puis la marche à suivre
 * (add_explanations, ou update_explanation pour une explication existante).
 */
export function buildExplanationRequestPrompt(analysis: Analysis, file: FileEntry, hunk: Hunk): string {
  const newRange = sideRange(hunk.newStart, hunk.newLines);
  const oldRange = sideRange(hunk.oldStart, hunk.oldLines);
  const where = [
    `- File: ${file.path}${file.oldPath !== null ? ` (renamed from ${file.oldPath})` : ""}`,
    newRange === null ? "- New side: no line (the section only removes code)." : `- New side (code after the feature): lines ${newRange}`,
    oldRange === null ? "- Old side: no line (the section only adds code)." : `- Old side (code before the feature): lines ${oldRange}`,
  ];

  return [
    `Explain a section of code in the feature analysis "${analysis.title}" (analysis_id: "${analysis.id}", project "${analysis.project}").`,
    `Repository: ${analysis.repoPath} — ${refsLabel(analysis)}.`,
    "",
    "Section to explain:",
    ...where,
    "",
    "Code of the section, as frozen in the analysis (columns: old line | new line, then + added, - removed, or a space for context):",
    "```",
    ...hunkCode(hunk),
    "```",
    "",
    "What to do:",
    `1. Read this code and what surrounds it (get_diff with analysis_id "${analysis.id}" and path "${file.path}", and the repository) until you understand what it does and how it works.`,
    `2. Record your explanations in the feature analyzer with add_explanations (analysis_id "${analysis.id}", path "${file.path}"): one explanation per meaningful block of the section, covering it from its first to its last line. ` +
      `Use "side": "new" with new-side line numbers for added or kept code, and "side": "old" with old-side line numbers for removed code.`,
    "3. In each explanation, say what the code does (inputs, outputs, effects), then how it works, step by step in the order of the code; name the key variables and the edge cases it handles. For removed code, say what it did and what replaces it. Describe, do not judge.",
    "4. If an explanation of the analysis already covers these lines (see get_analysis), rewrite it with update_explanation instead of adding a duplicate.",
    "5. Then tell me in a few lines which explanations you recorded.",
  ].join("\n");
}
