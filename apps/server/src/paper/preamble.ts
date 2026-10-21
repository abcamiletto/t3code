import * as LatexParser from "@unified-latex/unified-latex-util-parse";
import * as LatexSource from "@unified-latex/unified-latex-util-print-raw";

const parser = LatexParser.getParser();

export function preambleItems(source: string) {
  const items: Array<{ kind: "definition" | "input"; source: string }> = [];
  for (const node of parser.parse(source).content) {
    if (node.type === "environment" && node.env === "document") break;
    if (node.type !== "macro") continue;
    if (
      /^(?:newcommand|renewcommand|providecommand|(?:New|Renew|Provide|Declare)(?:Expandable)?DocumentCommand)$/.test(
        node.content,
      )
    ) {
      items.push({ kind: "definition", source: LatexSource.printRaw(node) });
    } else if (node.content === "input" || node.content === "include") {
      const file = node.args?.findLast((arg) => arg.openMark === "{");
      if (!file) throw new Error("Preview requires a braced input filename.");
      items.push({ kind: "input", source: LatexSource.printRaw(file.content).trim() });
    }
  }
  return items;
}
