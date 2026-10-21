export interface Point {
  x: number;
  y: number;
}
export interface PageSize {
  width: number;
  height: number;
}
export interface ViewportRect extends PageSize {
  left: number;
  top: number;
}
export interface PageLayout extends PageSize {
  top: number;
  scale: number;
}
export interface ScrollAnchor {
  page: number;
  offset: number;
}

export function viewportToPdf(point: Point, viewport: ViewportRect, page: PageSize): Point {
  return {
    x: ((point.x - viewport.left) * page.width) / viewport.width,
    y: ((point.y - viewport.top) * page.height) / viewport.height,
  };
}

export function layoutPages(pages: readonly PageSize[], width: number, zoom: number): PageLayout[] {
  let top = 16;
  return pages.map((page) => {
    const scale = (Math.max(1, width - 64) / page.width) * zoom;
    const layout = { width: page.width * scale, height: page.height * scale, scale, top };
    top += layout.height + 16;
    return layout;
  });
}

export function captureScrollAnchor(pages: readonly PageLayout[], scrollTop: number): ScrollAnchor {
  const page = Math.max(
    0,
    pages.findLastIndex((entry) => entry.top <= scrollTop),
  );
  const layout = pages[page];
  return { page, offset: layout ? (scrollTop - layout.top) / layout.scale : 0 };
}

export function restoreScrollAnchor(pages: readonly PageLayout[], anchor: ScrollAnchor): number {
  const page = pages[Math.min(anchor.page, pages.length - 1)];
  return page ? Math.max(0, page.top + anchor.offset * page.scale) : 0;
}

export function visiblePages(pages: readonly PageLayout[], top: number, height: number): number[] {
  const firstVisible = pages.findIndex((page) => page.top + page.height >= top);
  const first = firstVisible === -1 ? pages.length - 1 : firstVisible;
  const after = pages.findIndex((page) => page.top > top + height);
  const last = after === -1 ? pages.length - 1 : after - 1;
  return Array.from(
    { length: Math.max(0, Math.min(pages.length - 1, last + 1) - Math.max(0, first - 1) + 1) },
    (_, index) => Math.max(0, first - 1) + index,
  );
}
