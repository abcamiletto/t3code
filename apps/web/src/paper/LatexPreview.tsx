import * as Katex from "katex";
import "katex/dist/katex.min.css";
import * as React from "react";
import * as LatexDisplay from "./latexDisplay";

export function LatexPreview({ latex }: { latex: string }) {
  if (!latex.trim()) return <span className="text-muted-foreground">Passage removed.</span>;
  let nodes: LatexDisplay.DisplayNode[];
  try {
    nodes = LatexDisplay.latexToDisplay(latex);
  } catch (error) {
    return (
      <div role="alert" className="flex flex-col gap-2 text-xs text-destructive">
        <span>{error instanceof Error ? error.message : "Could not parse this LaTeX."}</span>
        <code className="whitespace-pre-wrap">{latex}</code>
      </div>
    );
  }
  const unrendered: string[] = [];
  const content = renderNodes(nodes, unrendered);
  return (
    <div className="whitespace-pre-wrap wrap-anywhere [&_.katex]:text-base">
      {content}
      {unrendered.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Project notation is shown as LaTeX. Use Typeset for the paper’s rendering.
        </p>
      )}
    </div>
  );
}

function renderNodes(
  nodes: readonly LatexDisplay.DisplayNode[],
  unrendered: string[],
  path = "",
): React.ReactNode[] {
  const source = (text: string, key: string) => {
    unrendered.push(text);
    return (
      <code
        key={key}
        aria-label="Unrendered LaTeX"
        className="rounded bg-muted px-1 font-mono text-xs wrap-anywhere"
      >
        {text}
      </code>
    );
  };
  return nodes.map((node, index) => {
    const key = `${path}.${index}`;
    switch (node.kind) {
      case "text":
        return <React.Fragment key={key}>{node.text}</React.Fragment>;
      case "muted":
        return (
          <span key={key} className="text-muted-foreground">
            {node.text}
          </span>
        );
      case "source":
        return source(node.text, key);
      case "italic":
        return <em key={key}>{renderNodes(node.children, unrendered, key)}</em>;
      case "bold":
        return <strong key={key}>{renderNodes(node.children, unrendered, key)}</strong>;
      case "math": {
        let html: string;
        try {
          html = Katex.renderToString(node.text, {
            displayMode: node.display,
            throwOnError: true,
            trust: false,
          });
        } catch {
          return source(node.text, key);
        }
        return (
          <span
            key={key}
            className={
              node.display
                ? "block max-w-full overflow-x-auto whitespace-normal [&_.katex-display]:w-max [&_.katex-display]:min-w-full"
                : undefined
            }
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      }
    }
  });
}
