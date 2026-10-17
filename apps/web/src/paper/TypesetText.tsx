import { Fragment } from "react";
import { latexToDisplay, type DisplayNode } from "./latexDisplay";

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
      case "math":
        return (
          <span key={key} className="font-mono text-xs text-muted-foreground">
            {node.text}
          </span>
        );
    }
  });
}

export function TypesetText({ latex }: { latex: string }) {
  return (
    <span className="font-serif whitespace-pre-wrap">
      <DisplayNodes nodes={latexToDisplay(latex)} />
    </span>
  );
}
