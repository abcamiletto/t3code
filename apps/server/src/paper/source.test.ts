import { expect, it } from "vite-plus/test";
import { originalRange, refineSource } from "./source.ts";

it("rejects absent, empty, repeated and overlapping originals", () => {
  expect(originalRange("aaa", "aa")).toBeUndefined();
  expect(originalRange("Hello", "")).toBeUndefined();
  expect(originalRange("Hello", "missing")).toBeUndefined();
  expect(originalRange("before\nfirst\nsecond\nafter", "first\nsecond")).toEqual({
    start: 7,
    startLine: 2,
    endLine: 3,
  });
});

it("refines normalized selected text to the tightest source range near a SyncTeX hit", () => {
  const source =
    "\\begin{document}\nContext.\nA \\textbf{better} result spans\ntwo lines.\nClosing.\n\\end{document}";
  expect(refineSource("main.tex", source, 5, "A better result spans two lines.")).toEqual({
    file: "main.tex",
    startLine: 3,
    endLine: 4,
    source: "A \\textbf{better} result spans\ntwo lines.",
  });
  expect(refineSource("main.tex", source, 5, "not present")).toEqual({
    file: "main.tex",
    startLine: 5,
    endLine: 5,
    source: "Closing.",
  });
});

it("does not treat selected PDF percent signs as LaTeX comments", () => {
  expect(
    refineSource("main.tex", "A 50\\% reduction.\nAnother line.", 2, "A 50% reduction."),
  ).toMatchObject({ startLine: 1, endLine: 1, source: "A 50\\% reduction." });
});

it("prefers the repeated text nearest the SyncTeX hit, including a hit inside a range", () => {
  const source = "Repeated text.\nContext.\nRepeated text.\nClosing.";
  expect(refineSource("main.tex", source, 3, "Repeated text.")).toMatchObject({
    startLine: 3,
    endLine: 3,
  });
  const multiline = "Repeated\ntext.\nContext.\nRepeated\ntext.\nClosing.";
  expect(refineSource("main.tex", multiline, 5, "Repeated text.")).toMatchObject({
    startLine: 4,
    endLine: 5,
  });
  expect(
    refineSource("main.tex", "Repeated text.\nContext.\nRepeated\ntext.", 4, "Repeated text."),
  ).toMatchObject({
    startLine: 3,
    endLine: 4,
  });
});

it("preserves CRLF originals and counts their offsets and lines exactly", () => {
  const source = "Context.\r\nA \\textbf{better} result spans\r\ntwo lines.\r\nClosing.\r\n";
  const refined = refineSource("main.tex", source, 3, "A better result spans two lines.");
  expect(refined).toEqual({
    file: "main.tex",
    startLine: 2,
    endLine: 3,
    source: "A \\textbf{better} result spans\r\ntwo lines.",
  });
  expect(originalRange(source, refined.source)).toEqual({ start: 10, startLine: 2, endLine: 3 });
  expect(originalRange(source, `${refined.source}\r\n`)).toEqual({
    start: 10,
    startLine: 2,
    endLine: 4,
  });
  expect(refineSource("main.tex", source, 4).source).toBe("Closing.");
  expect(refineSource("main.tex", source, 5).source).toBe("");
});
