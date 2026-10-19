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
      { kind: "math", text: "x_{1}", display: false },
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
