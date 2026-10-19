import type * as Ast from "@unified-latex/unified-latex-types";
import * as LatexParser from "@unified-latex/unified-latex-util-parse";
import * as LatexSource from "@unified-latex/unified-latex-util-print-raw";

export type DisplayNode =
  | { kind: "text" | "muted" | "source"; text: string }
  | { kind: "math"; text: string; display: boolean }
  | { kind: "italic" | "bold"; children: DisplayNode[] };

const parser = LatexParser.getParser({
  macros: Object.fromEntries(
    ["citep", "citet", "citealp", "citealt", "cref", "Cref", "autoref"].map((name) => [
      name,
      { signature: "s o o m" },
    ]),
  ),
});

export function latexToDisplay(latex: string): DisplayNode[] {
  return displayNodes(parser.parse(latex).content);
}

function displayNodes(content: readonly Ast.Node[]): DisplayNode[] {
  const nodes: DisplayNode[] = [];
  const text = (value: string) => {
    const last = nodes.at(-1);
    if (last?.kind === "text") last.text += value;
    else nodes.push({ kind: "text", text: value });
  };
  for (const node of content) {
    switch (node.type) {
      case "string":
        text(node.content.replaceAll("~", "\u00a0"));
        break;
      case "whitespace":
        text(" ");
        break;
      case "parbreak":
        text("\n\n");
        break;
      case "comment":
        break;
      case "group":
        nodes.push(...displayNodes(node.content));
        break;
      case "inlinemath":
      case "displaymath":
        nodes.push({
          kind: "math",
          text: LatexSource.printRaw(node.content),
          display: node.type === "displaymath",
        });
        break;
      case "environment":
      case "mathenv":
        if (node._renderInfo?.inMathMode) {
          // Labels identify equations in the full document; KaTeX has no document reference table.
          const body = node.content.filter(
            (entry) => entry.type !== "macro" || entry.content !== "label",
          );
          nodes.push({
            kind: "math",
            text: LatexSource.printRaw({ ...node, content: body }),
            display: true,
          });
        } else {
          nodes.push({ kind: "source", text: LatexSource.printRaw(node) });
        }
        break;
      case "macro": {
        const name = node.content;
        const argument = node.args?.findLast((arg) => arg.openMark === "{");
        if (/^cite/i.test(name) || /^(?:eqref|ref|cref|Cref|autoref|pageref)$/.test(name)) {
          nodes.push({ kind: "muted", text: /^cite/i.test(name) ? "[cite]" : "[ref]" });
        } else if (name === "label") {
          break;
        } else if (
          argument &&
          /^(?:emph|textit|textbf|section|subsection|subsubsection|paragraph|subparagraph)$/.test(
            name,
          )
        ) {
          nodes.push({
            kind: name === "emph" || name === "textit" ? "italic" : "bold",
            children: displayNodes(argument.content),
          });
        } else if (argument && /^(?:textrm|textnormal|textsf|texttt|mbox)$/.test(name)) {
          for (const child of displayNodes(argument.content)) {
            if (child.kind === "text") text(child.text);
            else nodes.push(child);
          }
        } else if ("{}%$&#_~".includes(name)) {
          text(name);
        } else if (name === "\\" || name === "par") {
          text("\n");
        } else if (name === ",") {
          text("\u2009");
        } else {
          nodes.push({ kind: "source", text: LatexSource.printRaw(node) });
        }
        break;
      }
      default:
        nodes.push({ kind: "source", text: LatexSource.printRaw(node) });
    }
  }
  return nodes;
}
