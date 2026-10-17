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

const normalize = (text: string) =>
  text
    .replace(/(?<!\\)%[^\n]*/g, "")
    .replace(/\\(?:begin|end|label|cite|ref)\*?\{[^}]*\}/g, "")
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, "")
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function refineSource(
  file: string,
  source: string,
  line: number,
  text?: string,
): PaperSourceRange {
  const lines = source.split(/\r?\n/);
  const hit = Math.min(lines.length, line);
  let startLine = hit;
  let endLine = hit;
  const selected = text?.replace(/\s+/g, " ").trim() ?? "";
  if (selected) {
    let best = Infinity;
    for (let start = Math.max(0, hit - 16); start < Math.min(lines.length, hit + 15); start++) {
      for (let end = start; end < Math.min(lines.length, hit + 15); end++) {
        if (end - start >= best) break;
        if (normalize(lines.slice(start, end + 1).join("\n")).includes(selected)) {
          startLine = start + 1;
          endLine = end + 1;
          best = end - start;
          break;
        }
      }
    }
  }
  return { file, startLine, endLine, source: lines.slice(startLine - 1, endLine).join("\n") };
}
