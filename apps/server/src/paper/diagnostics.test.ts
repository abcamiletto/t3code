import { describe, expect, it } from "vite-plus/test";

import { parseDiagnostics } from "./diagnostics.ts";

describe("parseDiagnostics", () => {
  it("reads located errors and wrapped warnings from a TeX log", () => {
    const log = [
      "(./sec/intro.tex",
      "./sec/intro.tex:12: Undefined control sequence.",
      "l.12 \\foo",
      "Package natbib Warning: Citation `smith' on page 1 undefined on input line 7.",
      "Package hyperref Warning: Token not allowed in a PDF string (Unicode):",
      "(hyperref)                removing `math shift' on input line 30.",
      "Overfull \\hbox (2.0pt too wide) in paragraph at lines 3--4",
      "! Emergency stop.",
    ].join("\n");
    expect(parseDiagnostics(log, "/paper")).toEqual([
      {
        severity: "error",
        message: "Undefined control sequence.",
        file: "sec/intro.tex",
        line: 12,
      },
      { severity: "error", message: "Emergency stop." },
      { severity: "warning", message: "Citation `smith' on page 1 undefined", line: 7 },
      {
        severity: "warning",
        message: "Token not allowed in a PDF string (Unicode): removing `math shift'",
        line: 30,
      },
    ]);
  });

  it("reads Tectonic's errors and strips the workspace path", () => {
    expect(parseDiagnostics("/paper/main.tex:5: Missing $ inserted", "/paper")).toEqual([
      { severity: "error", message: "Missing $ inserted", file: "main.tex", line: 5 },
    ]);
  });
});
