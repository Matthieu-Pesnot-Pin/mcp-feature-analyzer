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
