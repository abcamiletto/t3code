import type { PaperChoicePage, PaperDiagnostic } from "@t3tools/contracts";

const PAGE_MARK = "t3-paper-page:";
const FLOATS = ["figure", "figure*", "table", "table*"];
const MARGIN = 2;
// TeX reports dimensions in TeX points; PDF points are 1/72 in.
const PDF_POINTS_PER_TEX_POINT = 72 / 72.27;

/**
 * A standalone document that typesets each choice of a proposal on a page of its own, cut to the
 * text. It loads the paper's preamble and the last build's citations and labels, so macros,
 * packages, `\cite` and `\ref` render as they do in the paper. Text is set `width` PDF points
 * wide, the passage's line width in the paper; classes such as acmart only switch to two columns
 * after the preamble, so `\columnwidth` is not reliable here.
 */
export function snippetSource(input: {
  readonly preamble: string;
  readonly aux: string;
  readonly width: number | undefined;
  readonly choices: ReadonlyArray<string>;
}) {
  const references = input.aux
    .split("\n")
    .filter((line) => line.startsWith("\\bibcite{") || line.startsWith("\\newlabel{"));
  const lines = [
    ...input.preamble.trimEnd().split("\n"),
    "\\makeatletter",
    ...references,
    "\\begin{document}",
    // A float cannot go in a box, so figures and tables appear where the text puts them.
    ...FLOATS.map(
      (name) =>
        `\\renewenvironment{${name}}[1][]{\\def\\@captype{${name.replace("*", "")}}\\par\\noindent\\begin{minipage}{\\hsize}}{\\end{minipage}\\par}`,
    ),
    "\\makeatother",
    `\\hoffset=\\dimexpr-1in+${MARGIN}pt\\relax \\voffset=\\dimexpr-1in+${MARGIN}pt\\relax`,
  ];
  const width = input.width === undefined ? "\\columnwidth" : `${input.width.toFixed(3)}bp`;
  const ranges = input.choices.map((choice) => {
    lines.push(
      // Every choice numbers alike; the paper's numbers depend on what precedes the passage.
      "\\setcounter{equation}{0}\\setcounter{figure}{0}\\setcounter{table}{0}",
      `\\setbox0=\\vbox{\\hsize=${width}\\columnwidth=\\hsize\\linewidth=\\hsize\\parindent=0pt\\relax`,
    );
    const start = lines.length + 1;
    lines.push(...balanceEnvironments(choice).split("\n"));
    // TeX reports an unclosed group or formula on the line that ends the box.
    const end = lines.length + 1;
    lines.push(
      "\\par}",
      `\\pdfpagewidth=\\dimexpr\\wd0+${2 * MARGIN}pt\\relax`,
      `\\pdfpageheight=\\dimexpr\\ht0+\\dp0+${2 * MARGIN}pt\\relax`,
      `\\typeout{${PAGE_MARK}\\the\\pdfpagewidth,\\the\\pdfpageheight}`,
      "\\shipout\\box0",
    );
    return { start, end };
  });
  lines.push("\\end{document}", "");
  return { tex: lines.join("\n"), ranges };
}

/**
 * A passage with every environment it opens or closes completed, since a passage can start or end
 * inside a figure or a list that the rest of the file completes.
 */
export function balanceEnvironments(latex: string) {
  const open: string[] = [];
  const unopened: string[] = [];
  for (const [, kind, name] of latex
    .replace(/(?<!\\)%.*$/gm, "")
    .matchAll(/\\(begin|end)\{([^}]+)\}/g)) {
    if (kind === "begin") open.push(name!);
    else if (open.at(-1) === name) open.pop();
    else unopened.push(name!);
  }
  return [
    ...unopened.toReversed().map((name) => `\\begin{${name}}`),
    latex,
    ...open.toReversed().map((name) => `\\end{${name}}`),
  ].join("\n");
}

/**
 * The pages of a typeset snippet, with the first error TeX reported inside each choice. `file` is
 * the snippet's name as TeX reports it in errors.
 */
export function snippetPages(
  log: string,
  diagnostics: ReadonlyArray<PaperDiagnostic>,
  file: string,
  ranges: ReadonlyArray<{ readonly start: number; readonly end: number }>,
): PaperChoicePage[] {
  const sizes = [...log.matchAll(new RegExp(`${PAGE_MARK}([\\d.]+)pt,([\\d.]+)pt`, "g"))];
  return sizes.map(([, width, height], index) => {
    const range = ranges[index];
    const error = diagnostics.find(
      (entry) =>
        entry.severity === "error" &&
        entry.file === file &&
        entry.line !== undefined &&
        range !== undefined &&
        entry.line >= range.start &&
        entry.line <= range.end,
    );
    return {
      width: Number(width) * PDF_POINTS_PER_TEX_POINT,
      height: Number(height) * PDF_POINTS_PER_TEX_POINT,
      error: error?.message ?? null,
    };
  });
}
