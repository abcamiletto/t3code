import { describe, expect, it } from "vite-plus/test";
import {
  captureScrollAnchor,
  layoutPages,
  pdfToViewport,
  restoreScrollAnchor,
  viewportToPdf,
  visiblePages,
} from "./geometry";

describe("PDF points", () => {
  it("uses a top-left origin and round trips a scaled, scrolled viewport", () => {
    const viewport = { left: 120, top: -300, width: 918, height: 1188 };
    const page = { width: 612, height: 792 };
    expect(viewportToPdf({ x: 273, y: -3 }, viewport, page)).toEqual({ x: 102, y: 198 });
    expect(pdfToViewport({ x: 102, y: 198 }, viewport, page)).toEqual({ x: 273, y: -3 });
  });
});

describe("paper scroll anchors", () => {
  const sizes = [
    { width: 600, height: 800 },
    { width: 600, height: 1000 },
    { width: 600, height: 800 },
  ];
  it("keeps the page and offset through zoom, resizing, and a new revision", () => {
    const before = layoutPages(sizes, 664, 1);
    const anchor = captureScrollAnchor(before, 1082);
    expect(anchor).toEqual({ page: 1, offset: 250 });
    const after = layoutPages([{ width: 600, height: 900 }, ...sizes.slice(1)], 364, 1.5);
    expect(captureScrollAnchor(after, restoreScrollAnchor(after, anchor))).toEqual(anchor);
  });
  it("clamps a removed page to the end of a shorter revision", () => {
    const after = layoutPages(sizes.slice(0, 1), 664, 1);
    expect(restoreScrollAnchor(after, { page: 2, offset: 400 })).toBe(416);
  });
  it("preserves the top edge and renders only visible pages plus neighbors", () => {
    const pages = layoutPages(
      Array.from({ length: 100 }, () => sizes[0]!),
      664,
      1,
    );
    expect(restoreScrollAnchor(pages, captureScrollAnchor(pages, 0))).toBe(0);
    expect(visiblePages(pages, 1650, 500)).toEqual([1, 2, 3]);
    expect(visiblePages(pages, 1e8, 500)).toEqual([98, 99]);
  });
});
