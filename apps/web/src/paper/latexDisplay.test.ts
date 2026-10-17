import { describe, expect, it } from "vite-plus/test";
import { latexToDisplay } from "./latexDisplay";

describe("LaTeX display", () => {
  it("retains nested emphasis and bold without displaying commands", () => {
    expect(latexToDisplay(String.raw`An \emph{important \textbf{result}}.`)).toEqual([
      { kind: "text", text: "An " },
      {
        kind: "italic",
        children: [
          { kind: "text", text: "important " },
          { kind: "bold", children: [{ kind: "text", text: "result" }] },
        ],
      },
      { kind: "text", text: "." },
    ]);
  });
  it("replaces references, keeps math, and removes simple commands", () => {
    expect(
      latexToDisplay(String.raw`See~\ref{fig:x}, \citep[see]{key}: $x_1$ \textrm{works}.`),
    ).toEqual([
      { kind: "text", text: "See\u00a0" },
      { kind: "muted", text: "[ref]" },
      { kind: "text", text: ", " },
      { kind: "muted", text: "[cite]" },
      { kind: "text", text: ": " },
      { kind: "math", text: "x_1" },
      { kind: "text", text: " " },
      { kind: "text", text: "works." },
    ]);
  });
  it("keeps escaped punctuation and treats markup as text", () => {
    expect(latexToDisplay(String.raw`\$5 \& \{x\} <script>`)).toEqual([
      { kind: "text", text: "$5 & {x} <script>" },
    ]);
  });
});
