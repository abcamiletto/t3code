import type { PaperSourceRange } from "@t3tools/contracts";

export function originalRange(source: string, original: string) {
  const start = source.indexOf(original);
  if (original.length === 0 || start === -1 || source.indexOf(original, start + 1) !== -1)
    return undefined;
  return {
    start,
    startLine: source.slice(0, start).split("\n").length,
    endLine: source.slice(0, start + original.length).split("\n").length,
  };
}

export function refineSource(
  file: string,
  source: string,
  line: number,
  text?: string,
): PaperSourceRange {
  const lines = source.split(/\r?\n/);
  const offsets = [0, ...Array.from(source.matchAll(/\n/g), (match) => match.index + 1)];
  const hit = Math.min(lines.length, line);
  let startLine = hit;
  let endLine = hit;
  const selected = normalizeText(text ?? "");
  if (selected) {
    let normalized = "";
    const ends = lines.map((value) => {
      normalized += normalizeSource(value);
      return normalized.length;
    });
    let bestDistance = Infinity;
    for (
      let index = normalized.indexOf(selected);
      index >= 0;
      index = normalized.indexOf(selected, index + 1)
    ) {
      const start = ends.findIndex((end) => end > index) + 1;
      const end = ends.findIndex((end) => end >= index + selected.length) + 1;
      const distance = Math.max(start - hit, hit - end, 0);
      if (
        distance < bestDistance ||
        (distance === bestDistance && end - start < endLine - startLine)
      ) {
        startLine = start;
        endLine = end;
        bestDistance = distance;
      }
    }
    // A compiler hit can land on a blank paragraph boundary. Keep useful source
    // context even when rendered math or macros prevent an exact text match.
    if (bestDistance === Infinity && !lines[hit - 1]!.trim()) {
      let anchor = hit - 1;
      while (anchor > 0 && !lines[anchor]!.trim()) anchor--;
      while (anchor < lines.length - 1 && !lines[anchor]!.trim()) anchor++;
      startLine = anchor + 1;
      endLine = anchor + 1;
      while (startLine > 1 && lines[startLine - 2]!.trim()) startLine--;
      while (endLine < lines.length && lines[endLine]!.trim()) endLine++;
    }
  }
  return {
    file,
    startLine,
    endLine,
    source: source.slice(offsets[startLine - 1], offsets[endLine]).replace(/\r?\n$/, ""),
  };
}

function normalizeSource(text: string) {
  return normalizeText(
    text
      .replace(/(?<!\\)%[^\n]*/g, "")
      .replace(/\\(?:begin|end|label|cite|ref)\*?\{[^}]*\}/g, "")
      .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, "")
      .replace(/\\([&%$#_{}])/g, "$1"),
  );
}

function normalizeText(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\[\d+(?:\s*[-–,]\s*\d+)*\]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}
