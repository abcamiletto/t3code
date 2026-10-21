import type { PaperPdfBox } from "@t3tools/contracts";
import { viewportToPdf, type PageSize } from "./geometry";

export interface PaperSelection {
  text: string;
  page: number;
  x: number;
  y: number;
  boxes: PaperPdfBox[];
  left: number;
  formLeft: number;
  top: number;
}

export function readPaperSelection(
  root: HTMLElement,
  sizes: readonly PageSize[],
): PaperSelection | null {
  const selection = window.getSelection();
  if (
    !selection ||
    selection.isCollapsed ||
    selection.rangeCount === 0 ||
    !selection.toString().trim()
  )
    return null;
  const range = selection.getRangeAt(0);
  const start =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const startPage = start?.closest<HTMLElement>("[data-paper-page]");
  if (!startPage || !root.contains(startPage) || !root.contains(range.endContainer)) return null;
  const boxes: PaperPdfBox[] = [];
  let last: DOMRect | undefined;
  for (const element of root.querySelectorAll<HTMLElement>("[data-paper-page]")) {
    const pageNumber = Number(element.dataset.paperPage);
    const bounds = element.getBoundingClientRect();
    const size = sizes[pageNumber - 1]!;
    const layer = element.querySelector("[data-paper-text-layer]");
    if (!layer) continue;
    // A cross-page Range also includes page containers and canvases. Measure only text.
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!range.intersectsNode(node)) continue;
      const selected = document.createRange();
      selected.selectNodeContents(node);
      if (node === range.startContainer) selected.setStart(node, range.startOffset);
      if (node === range.endContainer) selected.setEnd(node, range.endOffset);
      if (selected.collapsed) continue;
      for (const rect of selected.getClientRects()) {
        const left = Math.max(bounds.left, rect.left);
        const top = Math.max(bounds.top, rect.top);
        const right = Math.min(bounds.right, rect.right);
        const bottom = Math.min(bounds.bottom, rect.bottom);
        if (right <= left || bottom <= top) continue;
        const from = viewportToPdf({ x: left, y: top }, bounds, size);
        const to = viewportToPdf({ x: right, y: bottom }, bounds, size);
        boxes.push({ page: pageNumber, ...from, width: to.x - from.x, height: to.y - from.y });
        last = rect;
      }
    }
  }
  const first = boxes[0];
  if (!first || !last) return null;
  const bounds = root.getBoundingClientRect();
  return {
    formLeft: Math.max(
      8,
      Math.min(root.clientWidth - 272, last.right - bounds.left - 256) + root.scrollLeft,
    ),
    text: selection.toString(),
    page: first.page,
    x: first.x,
    y: first.y,
    boxes,
    left:
      Math.max(8, Math.min(root.clientWidth - 40, last.right - bounds.left + 4)) + root.scrollLeft,
    top: last.bottom - bounds.top + root.scrollTop + 4,
  };
}
