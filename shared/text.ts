/**
 * Découpe un texte en lignes. Les fins de ligne `\n` et `\r\n` sont retirées ;
 * une fin de ligne finale ne crée pas de ligne vide supplémentaire.
 */
export function splitLines(content: string): string[] {
  if (content === "") return [];
  const lines = content.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  if (lines[lines.length - 1] === "" && content.endsWith("\n")) lines.pop();
  return lines;
}

/** Plage de lignes : « 12 », ou « 12-14 » avec `separator` entre les bornes. */
export function lineRange(startLine: number, endLine: number, separator = "-"): string {
  return startLine === endLine ? `${startLine}` : `${startLine}${separator}${endLine}`;
}

/** Emplacement d'une remarque : « chemin » pour un fichier entier, « chemin:ligne » sinon. */
export function noteLocationText(location: { path: string; line: number | null }): string {
  return location.line === null ? location.path : `${location.path}:${location.line}`;
}
