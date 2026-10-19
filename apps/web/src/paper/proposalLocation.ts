import { Util, type PDFDocumentProxy } from "pdfjs-dist";
import type { PaperPdfBox } from "@t3tools/contracts";
import { latexToDisplay, type DisplayNode } from "./latexDisplay";

// SyncTeX can omit a heading's source line. Locate its rendered text instead of
// guessing from a nearby source line, which could point at a different passage.
export async function locatePaperProposal(
  pdf: PDFDocumentProxy,
  original: string,
): Promise<PaperPdfBox[]> {
  const needle = normalize(displayText(latexToDisplay(original)));
  if (!needle) return [];
  let found: PaperPdfBox[] | undefined;
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    let text = "";
    const spans = content.items.flatMap((item) => {
      if (!("str" in item)) return [];
      const start = text.length;
      text += normalize(item.str);
      return [{ item, start, end: text.length }];
    });
    const start = text.indexOf(needle);
    if (start < 0) continue;
    // Repeated wording is ambiguous; don't highlight an arbitrary occurrence.
    if (found || text.indexOf(needle, start + 1) >= 0) return [];
    const end = start + needle.length;
    found = spans
      .filter((span) => span.start < end && span.end > start)
      .map(({ item }) => {
        const transform = Util.transform(viewport.transform, item.transform);
        const height = Math.hypot(transform[2]!, transform[3]!);
        const ascent = content.styles[item.fontName]?.ascent ?? 1;
        return {
          page: index,
          x: transform[4]!,
          y: transform[5]! - height * ascent,
          width: item.width,
          height,
        };
      });
  }
  return found ?? [];
}

function displayText(nodes: readonly DisplayNode[]): string {
  return nodes
    .map((node) => ("children" in node ? displayText(node.children) : node.text))
    .join("");
}

function normalize(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
