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
