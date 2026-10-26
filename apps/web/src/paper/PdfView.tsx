import type { PaperPdfBox } from "@t3tools/contracts";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import type { PageSize, PaperDocument } from "./pdfDocument";
import { PdfPage } from "./PdfPage";

const GAP = 16;

export interface PdfMark {
  readonly key: string;
  readonly boxes: readonly PaperPdfBox[];
  /** `proposal` shows only a margin marker: its boxes cover whole source lines. */
  readonly tone: "proposal" | "focus" | "comment";
  readonly label?: string;
  readonly onActivate?: () => void;
}

/** A passage to keep in view: the same `key` across documents keeps it at the same height. */
export interface PdfAnchor {
  readonly key: string;
  readonly box: PaperPdfBox;
}

export interface PdfTextSelection {
  readonly text: string;
  readonly boxes: readonly PaperPdfBox[];
  /** Where the selection ends, in the scrolled content's pixels. */
  readonly end: { readonly x: number; readonly y: number };
}

interface PageLayout {
  readonly top: number;
  readonly scale: number;
  readonly height: number;
}

function layoutPages(pages: readonly PageSize[], width: number, zoom: number) {
  const widest = Math.max(1, ...pages.map((page) => page.width));
  const scale = (Math.max(1, width - 2 * GAP) / widest) * zoom;
  let top = GAP;
  return pages.map((page): PageLayout => {
    const layout = { top, scale, height: page.height * scale };
    top += layout.height + GAP;
    return layout;
  });
}

export function PdfView(props: {
  readonly document: PaperDocument;
  readonly zoom: number;
  readonly marks: readonly PdfMark[];
  readonly anchor: PdfAnchor | null;
  readonly onPageChange: (page: number) => void;
  readonly onSelectText: (selection: PdfTextSelection | null) => void;
  readonly children?: ReactNode;
}) {
  const { document, zoom, anchor, onPageChange, onSelectText } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0, top: 0 });
  const layout = layoutPages(document.pages, viewport.width, zoom);
  const contentHeight = (layout.at(-1)?.top ?? 0) + (layout.at(-1)?.height ?? 0) + GAP;
  const contentWidth = Math.max(
    viewport.width,
    ...document.pages.map((page, index) => page.width * layout[index]!.scale + 2 * GAP),
  );
  const visible = layout.flatMap((page, index) =>
    page.top + page.height >= viewport.top - viewport.height &&
    page.top <= viewport.top + 2 * viewport.height
      ? [index + 1]
      : [],
  );

  // oxlint-disable-next-line t3code/react-effect-budget -- Subscribe to the PDF scroll container’s external resize observer.
  useEffect(
    () =>
      observeResize(scrollRef.current!, ([entry]) =>
        setViewport((current) => ({
          ...current,
          width: entry!.contentRect.width,
          height: entry!.contentRect.height,
        })),
      ),
    [],
  );

  // Where the reader is, so a new build or zoom keeps the same text on screen.
  const position = useRef({
    anchorKey: null as string | null,
    /** The anchor's distance from the top of the viewport, in pixels. */
    anchorOffset: 0,
    page: 0,
    /** Distance into the page in PDF points. */
    within: 0,
  });

  const boxTop = (box: PaperPdfBox) => {
    const page = layout[box.page - 1]!;
    return page.top + box.y * page.scale;
  };

  // Runs after every render and scrolls only when the anchored text moved: a new build, another
  // alternative, a zoom, or a new anchor. Scrolling updates the stored position first.
  // oxlint-disable-next-line t3code/react-effect-budget -- Synchronize the DOM scroll position after PDF layout changes, before paint.
  useLayoutEffect(() => {
    const element = scrollRef.current!;
    if (viewport.width === 0 || layout.length === 0) return;
    const previous = position.current;
    const anchorTop = anchor ? boxTop(anchor.box) : null;
    let top: number;
    if (anchorTop !== null && anchor?.key === previous.anchorKey) {
      top = anchorTop - previous.anchorOffset;
    } else if (anchorTop !== null) {
      top = anchorTop - viewport.height / 3;
    } else {
      const page = layout[Math.min(previous.page, layout.length - 1)]!;
      top = page.top + previous.within * page.scale;
    }
    if (Math.abs(element.scrollTop - top) > 1) element.scrollTop = Math.max(0, top);
    position.current = {
      ...previous,
      anchorKey: anchor?.key ?? null,
      anchorOffset: anchorTop === null ? 0 : anchorTop - element.scrollTop,
    };
  });

  const readSelection = () => {
    const selection = window.getSelection();
    const root = scrollRef.current;
    if (!root || !selection || selection.isCollapsed || !selection.toString().trim()) {
      onSelectText(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const boxes: PaperPdfBox[] = [];
    let end = { x: 0, y: 0 };
    const rootBounds = root.getBoundingClientRect();
    for (const pageElement of root.querySelectorAll<HTMLElement>("[data-paper-page]")) {
      const page = Number(pageElement.dataset.paperPage);
      const scale = layout[page - 1]?.scale;
      const bounds = pageElement.getBoundingClientRect();
      if (!scale) continue;
      // A range across pages also covers canvases and page containers; measure text only.
      const walker = window.document.createTreeWalker(pageElement, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!range.intersectsNode(node)) continue;
        const part = window.document.createRange();
        part.selectNodeContents(node);
        if (node === range.startContainer) part.setStart(node, range.startOffset);
        if (node === range.endContainer) part.setEnd(node, range.endOffset);
        for (const rect of part.getClientRects()) {
          if (rect.width < 1 || rect.height < 1) continue;
          boxes.push({
            page,
            x: (rect.left - bounds.left) / scale,
            y: (rect.top - bounds.top) / scale,
            width: rect.width / scale,
            height: rect.height / scale,
          });
          end = {
            x: rect.right - rootBounds.left + root.scrollLeft,
            y: rect.bottom - rootBounds.top + root.scrollTop,
          };
        }
      }
    }
    onSelectText(boxes.length > 0 ? { text: selection.toString(), boxes, end } : null);
  };

  return (
    <div
      ref={scrollRef}
      className="relative min-h-0 flex-1 overflow-auto bg-muted/40"
      onScroll={(event) => {
        const top = event.currentTarget.scrollTop;
        setViewport((current) => ({ ...current, top }));
        const index = Math.max(
          0,
          layout.findLastIndex((page) => page.top <= top + viewport.height / 2),
        );
        const page = layout[index]!;
        position.current = {
          ...position.current,
          page: index,
          within: (top - page.top) / page.scale,
          anchorOffset: anchor ? boxTop(anchor.box) - top : 0,
        };
        onPageChange(index + 1);
      }}
      onPointerUp={readSelection}
      onKeyUp={(event) => {
        // The form takes the focus, so it waits until a keyboard selection is complete.
        if (event.key === "Shift") readSelection();
      }}
    >
      <div className="relative" style={{ height: contentHeight, width: contentWidth }}>
        {visible.map((page) => (
          <PdfPage
            key={page}
            document={document}
            page={page}
            scale={layout[page - 1]!.scale}
            top={layout[page - 1]!.top}
          >
            {props.marks.map((mark) => (
              <PageMark key={mark.key} mark={mark} page={page} scale={layout[page - 1]!.scale} />
            ))}
          </PdfPage>
        ))}
        {props.children}
      </div>
    </div>
  );
}

function PageMark(props: {
  readonly mark: PdfMark;
  readonly page: number;
  readonly scale: number;
}) {
  const { mark, page, scale } = props;
  const boxes = mark.boxes.filter((box) => box.page === page);
  const first = boxes[0];
  if (!first) return null;
  return (
    <>
      {(mark.tone === "proposal" ? [] : boxes).map((box) => (
        <div
          key={`${box.x}:${box.y}`}
          className={cn(
            "pointer-events-none absolute z-10 rounded-xs mix-blend-multiply",
            mark.tone === "comment" ? "bg-paper-comment/50" : "bg-paper-proposal/30",
          )}
          style={{
            left: box.x * scale - 2,
            top: box.y * scale - 1,
            width: box.width * scale + 4,
            height: box.height * scale + 2,
          }}
        />
      ))}
      {mark.onActivate && first === mark.boxes[0] ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={mark.label}
                className="absolute z-20 w-1 rounded-full bg-paper-proposal/60 transition-[width,background-color] hover:w-1.5 hover:bg-paper-proposal"
                style={{
                  left: Math.max(2, Math.min(...boxes.map((box) => box.x)) * scale - 10),
                  top: first.y * scale - 1,
                  height:
                    Math.max(...boxes.map((box) => (box.y + box.height) * scale)) -
                    first.y * scale +
                    2,
                }}
                onClick={mark.onActivate}
              />
            }
          />
          <TooltipPopup>{mark.label}</TooltipPopup>
        </Tooltip>
      ) : null}
    </>
  );
}
