import { describe, expect, it } from "@effect/vitest";

import { balanceEnvironments } from "./snippet.ts";

describe("balanceEnvironments", () => {
  it("completes environments the passage leaves open or closes without opening", () => {
    expect(balanceEnvironments("Text.\n\\begin{figure}\n\\caption{A}")).toBe(
      "Text.\n\\begin{figure}\n\\caption{A}\n\\end{figure}",
    );
    expect(balanceEnvironments("\\item last\n\\end{itemize}\nNext % \\begin{table}")).toBe(
      "\\begin{itemize}\n\\item last\n\\end{itemize}\nNext % \\begin{table}",
    );
    expect(balanceEnvironments("$x$ and \\begin{equation}y\\end{equation}")).toBe(
      "$x$ and \\begin{equation}y\\end{equation}",
    );
  });
});
