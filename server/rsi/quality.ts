export interface RsiQuality { addedLines: number; deletedLines: number; changedLines: number; files: number; addedFunctions: number }
/** Lexical added function approximation, not semantic complexity analysis. */
export function measureQuality(diff: string): RsiQuality {
  let addedLines = 0, deletedLines = 0, files = 0, addedFunctions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) files++;
    else if (line.startsWith('+') && !line.startsWith('+++')) {
      addedLines++;
      if (/\bfunction\s*\w*\s*\(|\bdef\s+\w+\s*\(|\bfunc\s+|=>/.test(line)) addedFunctions++;
    } else if (line.startsWith('-') && !line.startsWith('---')) deletedLines++;
  }
  return { addedLines, deletedLines, changedLines: addedLines + deletedLines, files, addedFunctions };
}
