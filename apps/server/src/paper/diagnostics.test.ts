import { expect, it } from "vite-plus/test";
import { parseDiagnostics } from "./diagnostics.ts";

it("extracts Tectonic file locations and severity without build chatter", () => {
  expect(
    parseDiagnostics(
      `note: Running TeX ...
warning: main.tex:17: LaTeX Warning: Citation missing.
error: /paper/sections/intro.tex:9: Undefined control sequence.
error: /paper/sections/intro.tex:9: Undefined control sequence.
warning: warnings were issued by the TeX engine; use --print and/or --keep-logs for details.
`,
      "/paper",
    ),
  ).toEqual([
    {
      severity: "warning",
      file: "main.tex",
      line: 17,
      message: "LaTeX Warning: Citation missing.",
    },
    {
      severity: "error",
      file: "sections/intro.tex",
      line: 9,
      message: "Undefined control sequence.",
    },
    {
      severity: "warning",
      message:
        "warnings were issued by the TeX engine; use --print and/or --keep-logs for details.",
    },
  ]);
});

it("preserves unlocated errors and finds LaTeX warning line numbers", () => {
  expect(
    parseDiagnostics(
      `! Missing $ inserted.
LaTeX Warning: Reference undefined on input line 12.
Overfull \\hbox (2pt too wide) in paragraph at lines 7--8
`,
      "/paper",
    ),
  ).toEqual([
    { severity: "error", message: "Missing $ inserted." },
    { severity: "warning", message: "Reference undefined on input line 12.", line: 12 },
    {
      severity: "warning",
      message: "Overfull \\hbox (2pt too wide) in paragraph at lines 7--8",
      line: 7,
    },
  ]);
});
