import type { PaperPdfBox } from "@t3tools/contracts";
import { Util, type PDFDocumentProxy } from "pdfjs-dist";

/** A run of text on a page, in PDF points from the page's top-left corner. */
export interface TextRun {
  readonly page: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// Text the source and the PDF render differently: citations, references, math and markup.
const SEPARATOR =
  /%[^\n]*|\\(?:cite\w*|ref|eqref|[cC]ref|autoref|label|url|href|footnote)\*?(?:\[[^\]]*\])*\{[^}]*\}|\$[^$]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\\(?:begin|end)\{[^}]*\}/g;
const ANCHOR_LENGTH = 32;
const MIN_ANCHOR = 8;

const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/**
 * SyncTeX locates source lines, and one source line can hold a whole paragraph. This narrows a
 * passage to its own words: it finds the passage's first and last plain words among the text runs
 * inside the SyncTeX region. Returns `null` when the passage has no plain words to find.
 */
export function matchPassage(
  runs: readonly TextRun[],
  region: readonly PaperPdfBox[],
  latex: string,
): PaperPdfBox[] | null {
  const plain = latex
    .split(SEPARATOR)
    .map((part) => normalize(part.replace(/\\[a-zA-Z]+\*?/g, "")))
    .filter((part) => part.length >= MIN_ANCHOR);
  const first = plain[0]?.slice(0, ANCHOR_LENGTH);
  const last = plain.at(-1)?.slice(-ANCHOR_LENGTH);
  if (!first || !last) return null;

  const inside = runs.filter((run) =>
    region.some(
      (box) =>
        box.page === run.page &&
        run.y + run.height / 2 >= box.y &&
        run.y + run.height / 2 <= box.y + box.height &&
        run.x < box.x + box.width &&
        run.x + run.width > box.x,
    ),
  );
  // Each normalized character remembers the run and the character position it came from.
  let stream = "";
  const origin: Array<{ readonly run: number; readonly index: number }> = [];
  inside.forEach((run, runIndex) => {
    Array.from(run.text).forEach((character, index) => {
      for (const normalized of normalize(character)) {
        stream += normalized;
        origin.push({ run: runIndex, index });
      }
    });
  });
  const start = stream.indexOf(first);
  const end = stream.lastIndexOf(last);
  if (start === -1 || end === -1 || end + last.length <= start) return null;

  const boxes: PaperPdfBox[] = [];
  const from = origin[start]!;
  const to = origin[end + last.length - 1]!;
  for (let index = from.run; index <= to.run; index++) {
    const run = inside[index]!;
    const length = Array.from(run.text).length;
    const left = index === from.run ? from.index : 0;
    const right = index === to.run ? to.index + 1 : length;
    const x = run.x + (run.width * left) / length;
    const width = (run.width * (right - left)) / length;
    const previous = boxes.at(-1);
    // Runs on the same baseline join into one box per line.
    if (previous && previous.page === run.page && Math.abs(previous.y - run.y) < run.height / 2) {
      const right = Math.max(previous.x + previous.width, x + width);
      boxes[boxes.length - 1] = {
        ...previous,
        x: Math.min(previous.x, x),
        width: right - Math.min(previous.x, x),
      };
    } else {
      boxes.push({ page: run.page, x, y: run.y, width, height: run.height });
    }
  }
  return boxes;
}

/** The text runs of the pages a region covers. */
export async function readTextRuns(
  pdf: PDFDocumentProxy,
  region: readonly PaperPdfBox[],
): Promise<TextRun[]> {
  const pages = [...new Set(region.map((box) => box.page))].toSorted((a, b) => a - b);
  const runs: TextRun[] = [];
  for (const number of pages) {
    const page = await pdf.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const [, , c, d, x, baseline] = Util.transform(viewport.transform, item.transform);
      const height = Math.hypot(c!, d!);
      const ascent = content.styles[item.fontName]?.ascent ?? 0.8;
      runs.push({
        page: number,
        text: item.str,
        x: x!,
        y: baseline! - height * ascent,
        width: item.width,
        height,
      });
    }
  }
  return runs;
}
