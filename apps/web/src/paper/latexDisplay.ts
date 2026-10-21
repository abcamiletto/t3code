import type * as Ast from "@unified-latex/unified-latex-types";
import * as LatexParser from "@unified-latex/unified-latex-util-parse";
import * as LatexSource from "@unified-latex/unified-latex-util-print-raw";
import * as LatexMacros from "@unified-latex/unified-latex-util-macros";

export type DisplayNode =
  | { kind: "text" | "muted" | "source"; text: string }
  | { kind: "math"; text: string; display: boolean }
  | { kind: "italic" | "bold"; children: DisplayNode[] };

const standardMacros = Object.fromEntries(
  ["citep", "citet", "citealp", "citealt", "cref", "Cref", "autoref"].map((name) => [
    name,
    { signature: "s o o m" },
  ]),
);
const parser = LatexParser.getParser({ macros: standardMacros });

export function latexToDisplay(latex: string, preamble = ""): DisplayNode[] {
  const definitions = LatexMacros.listNewcommands(parser.parse(preamble));
  if (definitions.length === 0) return displayNodes(parser.parse(latex).content);
  const projectParser = LatexParser.getParser({
    macros: {
      ...standardMacros,
      ...Object.fromEntries(definitions.map(({ name, signature }) => [name, { signature }])),
    },
  });
  for (let expansion = 0; expansion < 100; expansion++) {
    const tree = projectParser.parse(latex);
    const before = LatexSource.printRaw(tree);
    LatexMacros.expandMacrosExcludingDefinitions(tree, definitions);
    const after = LatexSource.printRaw(tree);
    if (after === before) return displayNodes(tree.content);
    // Reparse expanded arguments and commands in their new math/text context.
    latex = after;
  }
  throw new Error("Project macros did not finish expanding.");
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
        if (node.content.includes("$")) {
          throw new Error("Unmatched math delimiter. Include both delimiters in the proposal.");
        }
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
        if (["begin", "end", "(", ")", "[", "]"].includes(name)) {
          throw new Error(
            "Incomplete LaTeX. Include matching math delimiters or begin/end tags in the proposal.",
          );
        }
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
