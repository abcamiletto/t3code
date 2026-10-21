import * as Katex from "katex";
import "katex/dist/katex.min.css";
import { Fragment } from "react";
import { latexToDisplay, type DisplayNode } from "./latexDisplay";

export function TypesetText({
  latex,
  preamble = "",
  error = null,
}: {
  latex: string;
  preamble?: string;
  error?: string | null;
}) {
  if (error) return <PreviewError source={latex} error={new Error(error)} />;
  let nodes: DisplayNode[];
  try {
    nodes = latexToDisplay(latex, preamble);
  } catch (error) {
    return <PreviewError source={latex} error={error} />;
  }
  return (
    <span className="font-serif whitespace-pre-wrap">
      <DisplayNodes nodes={nodes} />
    </span>
  );
}

function DisplayNodes({ nodes, path = "" }: { nodes: readonly DisplayNode[]; path?: string }) {
  return nodes.map((node, index) => {
    const key = `${path}.${index}`;
    switch (node.kind) {
      case "text":
        return <Fragment key={key}>{node.text}</Fragment>;
      case "italic":
        return (
          <em key={key}>
            <DisplayNodes nodes={node.children} path={key} />
          </em>
        );
      case "bold":
        return (
          <strong key={key}>
            <DisplayNodes nodes={node.children} path={key} />
          </strong>
        );
      case "muted":
        return (
          <span key={key} className="text-muted-foreground">
            {node.text}
          </span>
        );
      case "source":
        return (
          <code key={key} className="font-mono text-xs">
            {node.text}
          </code>
        );
      case "math":
        return <MathPreview key={key} source={node.text} display={node.display} />;
    }
  });
}

function MathPreview({ source, display }: { source: string; display: boolean }) {
  let html: string;
  try {
    html = Katex.renderToString(source, {
      displayMode: display,
      throwOnError: true,
      trust: false,
    });
  } catch (error) {
    return <PreviewError source={source} error={error} />;
  }
  return (
    <span
      className={
        display
          ? "block max-w-full overflow-x-auto whitespace-normal [&_.katex-display]:w-max [&_.katex-display]:min-w-full"
          : undefined
      }
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function PreviewError({ source, error }: { source: string; error: unknown }) {
  return (
    <span
      role="alert"
      className="inline-flex max-w-full flex-col gap-1 rounded-sm border border-destructive/25 p-2 text-xs text-destructive"
    >
      <span>
        LaTeX preview unavailable: {error instanceof Error ? error.message : "Unsupported LaTeX"}
      </span>
      <code className="overflow-x-auto font-mono whitespace-pre-wrap">{source}</code>
    </span>
  );
}
