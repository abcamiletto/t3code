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
  const page = Number(startPage.dataset.paperPage);
  const rects = Array.from(range.getClientRects());
  const first = rects[0];
  if (!first) return null;
  const point = viewportToPdf(
    { x: first.left, y: first.top },
    startPage.getBoundingClientRect(),
    sizes[page - 1]!,
  );
  const boxes: PaperPdfBox[] = [];
  for (const element of root.querySelectorAll<HTMLElement>("[data-paper-page]")) {
    const pageNumber = Number(element.dataset.paperPage);
    const bounds = element.getBoundingClientRect();
    const size = sizes[pageNumber - 1]!;
    for (const rect of rects) {
      const left = Math.max(bounds.left, rect.left);
      const top = Math.max(bounds.top, rect.top);
      const right = Math.min(bounds.right, rect.right);
      const bottom = Math.min(bounds.bottom, rect.bottom);
      if (right <= left || bottom <= top) continue;
      const from = viewportToPdf({ x: left, y: top }, bounds, size);
      const to = viewportToPdf({ x: right, y: bottom }, bounds, size);
      boxes.push({ page: pageNumber, ...from, width: to.x - from.x, height: to.y - from.y });
    }
  }
  const bounds = root.getBoundingClientRect();
  return {
    formLeft: Math.max(
      8,
      Math.min(root.clientWidth - 272, first.left - bounds.left) + root.scrollLeft,
    ),
    text: selection.toString(),
    page,
    ...point,
    boxes,
    left: Math.max(8, Math.min(root.clientWidth - 40, first.left - bounds.left)) + root.scrollLeft,
    top: Math.max(8, first.top - bounds.top + root.scrollTop - 30),
  };
}
