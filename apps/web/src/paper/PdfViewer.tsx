import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { PaperPdfBox, PaperProposal, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { DraftId } from "~/composerDraftStore";
import { observeResize } from "~/lib/observeResize";
import { EMPTY_PAPER_HIGHLIGHTS, usePaperHighlights, type PaperHighlight } from "./commentStore";
import {
  captureScrollAnchor,
  layoutPages,
  restoreScrollAnchor,
  visiblePages,
  type PageLayout,
  type ScrollAnchor,
} from "./geometry";
import { readPaperDocument, type PaperDocument } from "./pdf";
import { PdfPage } from "./PdfPage";
import { ProposalOverlay } from "./ProposalOverlay";
import { readPaperSelection, type PaperSelection } from "./selection";
import { SelectionComment } from "./SelectionComment";
import { locatePaperProposal } from "./proposalLocation";

type PaperViewerContext = {
  threadRef: ScopedThreadRef;
  cwd: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  proposals: readonly PaperProposal[];
  reveal: { proposalId: string; requestId: number } | undefined;
};

function DocumentLayer({
  document,
  layout,
  scrollTop,
  height,
  hidden,
  onReady,
  onError,
  comments,
  context,
}: {
  document: PaperDocument;
  layout: PageLayout[];
  scrollTop: number;
  height: number;
  hidden: boolean;
  onReady: (id: string) => void;
  onError: (error: unknown) => void;
  comments: readonly PaperHighlight[];
  context: PaperViewerContext;
}) {
  const pages = visiblePages(layout, scrollTop, height);
  const [review, setReview] = useState({
    request: context.reveal,
    proposalId: context.reveal?.proposalId,
    page: undefined as number | undefined,
  });
  if (review.request !== context.reveal)
    setReview({ request: context.reveal, proposalId: context.reveal?.proposalId, page: undefined });
  const readyPages = useRef(new Set<string>());
  const ready = (page: number, rendered: boolean) => {
    const key = `${page}:${layout[page - 1]!.scale}`;
    if (!rendered) {
      readyPages.current.delete(key);
      return;
    }
    readyPages.current.add(key);
    if (pages.every((index) => readyPages.current.has(`${index + 1}:${layout[index]!.scale}`)))
      onReady(document.id);
  };
  const last = layout.at(-1);
  return (
    <div
      className={hidden ? "pointer-events-none invisible absolute inset-x-0 top-0" : "relative"}
      aria-hidden={hidden || undefined}
      style={{
        height: last ? last.top + last.height + 16 : 0,
        minWidth: Math.max(0, ...layout.map((page) => page.width)) + 64,
      }}
    >
      {pages.map((index) => {
        const page = layout[index]!;
        return (
          <div
            key={index}
            data-paper-page={hidden ? undefined : index + 1}
            className="absolute left-1/2 -translate-x-1/2 bg-white shadow-sm"
            style={{ top: page.top, width: page.width, height: page.height }}
            onClick={(event) => {
              if (
                hidden ||
                event.button !== 0 ||
                !(event.target instanceof Element) ||
                !event.target.closest("[data-paper-text-layer]") ||
                window.getSelection()?.isCollapsed === false
              )
                return;
              const bounds = event.currentTarget.getBoundingClientRect();
              const x = (event.clientX - bounds.left) / page.scale;
              const y = (event.clientY - bounds.top) / page.scale;
              const proposal = context.proposals.find(
                (proposal) =>
                  (proposal.status === "pending" || proposal.id === context.reveal?.proposalId) &&
                  proposal.boxes.some(
                    (box) =>
                      box.page === index + 1 &&
                      x >= box.x &&
                      x <= box.x + box.width &&
                      y >= box.y &&
                      y <= box.y + box.height,
                  ),
              );
              if (proposal) setReview({ ...review, proposalId: proposal.id, page: index + 1 });
            }}
          >
            <PdfPage
              pdf={document.pdf}
              page={index + 1}
              layout={page}
              onReady={ready}
              onError={onError}
            />
            {!hidden && (
              <>
                {comments
                  .filter((box) => box.page === index + 1)
                  .map((box) => (
                    <div
                      key={box.id}
                      className="pointer-events-none absolute z-10 bg-warning/15"
                      style={{
                        left: box.x * page.scale,
                        top: box.y * page.scale,
                        width: box.width * page.scale,
                        height: box.height * page.scale,
                      }}
                    />
                  ))}
                {context.proposals
                  .filter(
                    (proposal) =>
                      (proposal.status === "pending" ||
                        proposal.id === context.reveal?.proposalId) &&
                      proposal.boxes.some((box) => box.page === index + 1),
                  )
                  .map((proposal) => (
                    <ProposalOverlay
                      key={proposal.id}
                      proposal={proposal}
                      page={index + 1}
                      scale={page.scale}
                      {...context}
                      open={
                        review.proposalId === proposal.id &&
                        (review.page ?? proposal.boxes[0]?.page) === index + 1
                      }
                      onOpenChange={(open) =>
                        setReview({
                          ...review,
                          proposalId: open ? proposal.id : undefined,
                          page: index + 1,
                        })
                      }
                    />
                  ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function PdfViewer({
  url,
  zoom,
  onPageChange,
  onComment,
  assetError,
  ...context
}: PaperViewerContext & {
  url: string | null;
  assetError: string | null;
  zoom: number;
  onPageChange: (page: number, count: number) => void;
  onComment: (selection: PaperSelection, comment: string) => Promise<boolean>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const ownedDocuments = useRef(new Set<PaperDocument>());
  const anchorRef = useRef<ScrollAnchor>({ page: 0, offset: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollTop: 0 });
  const [documents, setDocuments] = useState<{
    active: PaperDocument | null;
    pending: PaperDocument | null;
  }>({ active: null, pending: null });
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<PaperSelection | null>(null);
  const workspaceKey = `${scopedThreadKey(context.threadRef)}:${context.cwd}`;
  const comments = usePaperHighlights(
    (state) => state.byWorkspace[workspaceKey] ?? EMPTY_PAPER_HIGHLIGHTS,
  );
  const addHighlights = usePaperHighlights((state) => state.add);
  const clearHighlights = usePaperHighlights((state) => state.clear);
  const layout = layoutPages(documents.active?.sizes ?? [], viewport.width, zoom);
  const pendingLayout = layoutPages(documents.pending?.sizes ?? [], viewport.width, zoom);
  const pendingTop = restoreScrollAnchor(
    pendingLayout,
    captureScrollAnchor(layout, viewport.scrollTop),
  );
  const showError = () => setError("Couldn't load the PDF");
  const loadError = useEffectEvent(showError);

  useEffect(() => {
    if (url === null) return;
    const abort = new AbortController();
    void readPaperDocument(url, abort.signal)
      .then((document) => {
        if (abort.signal.aborted) {
          void document.pdf.loadingTask.destroy();
          return;
        }
        ownedDocuments.current.add(document);
        setError(null);
        setDocuments((current) => ({ ...current, pending: document }));
      })
      .catch(() => {
        if (!abort.signal.aborted) loadError();
      });
    return () => abort.abort();
  }, [url]);

  // The viewer owns workers so React Strict Mode can replay a page's effects safely.
  useEffect(() => {
    for (const document of ownedDocuments.current) {
      if (document !== documents.active && document !== documents.pending) {
        void document.pdf.loadingTask.destroy();
        ownedDocuments.current.delete(document);
      }
    }
  }, [documents]);
  useEffect(
    () => () => {
      for (const document of ownedDocuments.current) void document.pdf.loadingTask.destroy();
      ownedDocuments.current.clear();
    },
    [],
  );

  useEffect(
    () =>
      observeResize(rootRef.current!, ([entry]) => {
        setViewport((current) => ({
          ...current,
          width: entry!.contentRect.width,
          height: entry!.contentRect.height,
        }));
      }),
    [],
  );

  useLayoutEffect(() => {
    if (layout.length > 0)
      rootRef.current!.scrollTop = restoreScrollAnchor(layout, anchorRef.current);
  }, [layout]);

  const lastReveal = useRef<typeof context.reveal>(undefined);
  const revealProposal = context.proposals.find(
    (proposal) => proposal.id === context.reveal?.proposalId,
  );
  const [location, setLocation] = useState<{
    documentId: string;
    proposalId: string;
    boxes: PaperPdfBox[];
  } | null>(null);
  const needsTextLocation =
    revealProposal && (revealProposal.boxes.length === 0 || revealProposal.status !== "pending");
  useEffect(() => {
    const document = documents.active;
    if (!document || !revealProposal || !needsTextLocation) return;
    let cancelled = false;
    const save = (boxes: PaperPdfBox[]) => {
      if (!cancelled)
        setLocation({ documentId: document.id, proposalId: revealProposal.id, boxes });
    };
    const text =
      revealProposal.status === "applied" && revealProposal.appliedOptionIndex !== undefined
        ? revealProposal.options[revealProposal.appliedOptionIndex]!.latex
        : revealProposal.original;
    void locatePaperProposal(document.pdf, text)
      .then(save)
      .catch(() => save([]));
    return () => {
      cancelled = true;
    };
  }, [documents.active, revealProposal, needsTextLocation]);
  const locatedBoxes =
    location?.documentId === documents.active?.id && location?.proposalId === revealProposal?.id
      ? location?.boxes
      : undefined;
  const viewerContext = needsTextLocation
    ? {
        ...context,
        proposals: context.proposals.map((proposal) =>
          proposal.id === revealProposal?.id
            ? { ...proposal, boxes: locatedBoxes ?? [] }
            : proposal,
        ),
      }
    : context;
  const revealBox = needsTextLocation ? locatedBoxes?.[0] : revealProposal?.boxes[0];
  useLayoutEffect(() => {
    if (!context.reveal || !revealBox || !documents.active || lastReveal.current === context.reveal)
      return;
    const page = layout[revealBox.page - 1];
    if (page) {
      lastReveal.current = context.reveal;
      const top = Math.max(0, page.top + revealBox.y * page.scale - viewport.height / 4);
      rootRef.current!.scrollTop = top;
      anchorRef.current = captureScrollAnchor(layout, top);
    }
  }, [context.reveal, documents.active, revealBox, layout, viewport.height]);

  const ready = (id: string) => {
    if (documents.pending?.id !== id) return;
    const next = documents.pending;
    const anchor = captureScrollAnchor(layout, rootRef.current!.scrollTop);
    anchorRef.current = anchor;
    const scrollTop = restoreScrollAnchor(layoutPages(next.sizes, viewport.width, zoom), anchor);
    setViewport((current) => ({ ...current, scrollTop }));
    // Highlights mark positions in the previous build; the text under them may have moved.
    if (documents.active) clearHighlights(workspaceKey);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    setDocuments({ active: next, pending: null });
    onPageChange(Math.min(anchor.page + 1, next.pdf.numPages), next.pdf.numPages);
  };

  const submitComment = async (selected: PaperSelection, text: string) => {
    const success = await onComment(selected, text);
    if (success) {
      addHighlights(workspaceKey, selected.boxes);
      window.getSelection()?.removeAllRanges();
    }
    return success;
  };

  return (
    <div
      ref={rootRef}
      className="relative min-h-0 flex-1 overflow-auto bg-muted/25"
      onScroll={(event) => {
        const { scrollTop } = event.currentTarget;
        const anchor = captureScrollAnchor(layout, scrollTop);
        anchorRef.current = anchor;
        setViewport((current) => ({ ...current, scrollTop }));
        if (documents.active) onPageChange(anchor.page + 1, documents.active.pdf.numPages);
      }}
      onPointerUp={(event) => {
        if (event.target instanceof Element && !event.target.closest("[data-paper-text-layer]"))
          return;
        if (documents.active)
          setSelection(readPaperSelection(event.currentTarget, documents.active.sizes));
      }}
      onKeyUp={(event) => {
        if (event.key === "Shift" && documents.active)
          setSelection(readPaperSelection(event.currentTarget, documents.active.sizes));
      }}
    >
      {viewport.width > 0 &&
        [documents.active, documents.pending].map(
          (document) =>
            document && (
              <DocumentLayer
                key={document.id}
                document={document}
                hidden={document !== documents.active}
                layout={document === documents.active ? layout : pendingLayout}
                scrollTop={document === documents.active ? viewport.scrollTop : pendingTop}
                height={viewport.height}
                onReady={ready}
                onError={showError}
                comments={comments}
                context={viewerContext}
              />
            ),
        )}
      {selection && (
        <SelectionComment
          key={`${selection.page}:${selection.x}:${selection.y}`}
          selection={selection}
          onSubmit={submitComment}
          onCancel={() => setSelection(null)}
        />
      )}
      {(error || assetError || locatedBoxes?.length === 0) && (
        <div
          role="alert"
          className="absolute inset-x-4 z-30 rounded-md border border-border bg-background px-3 py-2 text-xs text-destructive shadow-sm"
          style={{ top: viewport.scrollTop + 16 }}
        >
          {error ??
            assetError ??
            "Couldn't locate this passage in the current PDF. You can still review it in the chat."}
        </div>
      )}
    </div>
  );
}
