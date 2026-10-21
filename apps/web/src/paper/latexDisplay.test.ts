import { describe, expect, it } from "vite-plus/test";
import { latexToDisplay } from "./latexDisplay";

describe("LaTeX display", () => {
  it("expands project text macros with nested emphasis and bold", () => {
    expect(
      latexToDisplay(
        String.raw`An \result{result}.`,
        String.raw`\newcommand{\result}[1]{\emph{important \textbf{#1}}}`,
      ),
    ).toEqual([
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
  it("expands project math macros while retaining references and text", () => {
    expect(
      latexToDisplay(
        String.raw`See~\ref{fig:x}, \citep[see]{key}: $\com_1$ \textrm{works}.`,
        String.raw`\newcommand{\pp}{\mathbf{p}}\newcommand{\com}{\bar{\pp}}`,
      ),
    ).toEqual([
      { kind: "text", text: "See\u00a0" },
      { kind: "muted", text: "[ref]" },
      { kind: "text", text: ", " },
      { kind: "muted", text: "[cite]" },
      { kind: "text", text: ": " },
      { kind: "math", text: String.raw`\bar{\mathbf{p}}_{1}`, display: false },
      { kind: "text", text: " works." },
    ]);
  });
  it("preserves display equations and matrix structure without treating labels as text", () => {
    const nodes = latexToDisplay(String.raw`\(x_i\) $$x^2$$ \[y\]
\begin{equation}
T_j=\begin{bmatrix}R_j&p_j\\0&1\end{bmatrix}\label{eq:fk}
\end{equation}`);
    const math = nodes.filter((node) => node.kind === "math");
    expect(math.map((node) => node.display)).toEqual([false, true, true, true]);
    expect(math[3]!.text).toContain(String.raw`\begin{bmatrix}R_{j}&p_{j}\\0&1\end{bmatrix}`);
    expect(math[3]!.text).not.toContain("label");
    expect(math[3]!.text).toContain(String.raw`\begin{equation}`);
  });
  it("keeps escaped punctuation and treats markup as text", () => {
    expect(latexToDisplay(String.raw`\$5 \& \{x\} <script>`)).toEqual([
      { kind: "text", text: "$5 & {x} <script>" },
    ]);
  });
});
