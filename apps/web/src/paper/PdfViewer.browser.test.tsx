import { EnvironmentId, ThreadId, type PaperProposal } from "@t3tools/contracts";
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { PdfViewer } from "./PdfViewer";
import pdfUrl from "./fixtures/comment.pdf?url";
import "../index.css";
import { useComposerDraftStore } from "~/composerDraftStore";
import { buildMessageContext } from "~/lib/composerContextRecords";
import { projectComposerContextForProvider } from "@t3tools/shared/composerContextReferences";
import { paperReviewComment, PAPER_SECTIONS } from "./reviewComment";

it("keeps comments open while typing and reveals proposals at their PDF passage", async () => {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;width:600px;height:400px";
  document.body.append(container);
  const root = createRoot(container);
  const onPageChange = vi.fn();
  const threadRef = {
    environmentId: EnvironmentId.make("paper-test"),
    threadId: ThreadId.make("paper-thread"),
  };
  const onComment = vi.fn<ComponentProps<typeof PdfViewer>["onComment"]>(
    async (selection, text) => {
      const comment = paperReviewComment(
        { file: "main.tex", startLine: 1, endLine: 1 },
        PAPER_SECTIONS.comment,
        text,
        selection.text,
      );
      useComposerDraftStore
        .getState()
        .addReviewComment(threadRef, comment, { insertAtCaret: false });
      return comment.id;
    },
  );
  const viewerProps: ComponentProps<typeof PdfViewer> = {
    url: pdfUrl,
    zoom: 1,
    assetError: null,
    cwd: "/paper",
    threadRef,
    composerDraftTarget: threadRef,
    proposals: [],
    reveal: undefined,
    onPageChange,
    onComment,
  };
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  try {
    await act(() => root.render(<PdfViewer {...viewerProps} />));
    const text = await vi.waitFor(
      () => {
        const span = container.querySelector('[data-paper-page="1"] [data-paper-text-layer] span');
        expect(span?.textContent).toBe("An original sentence.");
        return span!;
      },
      { timeout: 10_000 },
    );
    await act(() => {
      const range = document.createRange();
      range.selectNodeContents(text);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      text.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await act(() => userEvent.click(page.getByRole("button", { name: "Comment", exact: true })));
    // Moving focus from PDF text into a textarea collapses the document selection.
    window.getSelection()!.removeAllRanges();
    await act(() => userEvent.keyboard("ab{Shift>}C{/Shift}{Shift>}{Enter}{/Shift}def"));
    expect(container.querySelector("textarea")?.value).toBe("abC\ndef");
    expect(onComment).not.toHaveBeenCalled();
    await act(() => userEvent.keyboard("{Enter}"));
    expect(onComment).toHaveBeenCalledWith(
      expect.objectContaining({ text: "An original sentence.", page: 1 }),
      "abC\ndef",
    );
    expect(container.querySelector("textarea")).toBeNull();
    const secondPageText = container.querySelector(
      '[data-paper-page="2"] [data-paper-text-layer] span',
    )!;
    await act(() => {
      const range = document.createRange();
      range.setStart(text.firstChild!, 3);
      range.setEnd(secondPageText.firstChild!, 5);
      window.getSelection()!.addRange(range);
      secondPageText.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await act(() => userEvent.click(page.getByRole("button", { name: "Comment", exact: true })));
    await act(() => userEvent.keyboard("Across pages{Enter}"));
    const crossPageSelection = onComment.mock.lastCall![0];
    expect(crossPageSelection.text).toBe(
      text.textContent!.slice(3) + secondPageText.textContent!.slice(0, 5),
    );
    expect([...new Set(crossPageSelection.boxes.map((box) => box.page))]).toEqual([1, 2]);
    expect(crossPageSelection.boxes).toHaveLength(2);
    expect(crossPageSelection.boxes.every((box) => box.height < 30)).toBe(true);
    const draftStore = useComposerDraftStore.getState();
    const [firstComment, secondComment] = draftStore.getComposerDraft(threadRef)!.reviewComments;
    const highlightsFor = (id: string) =>
      container.querySelectorAll(`[data-paper-comment="${id}"]`);
    expect(highlightsFor(firstComment!.id).length).toBeGreaterThan(0);
    expect(highlightsFor(secondComment!.id)).toHaveLength(2);
    await act(() => draftStore.removeReviewComment(threadRef, firstComment!.id));
    expect(highlightsFor(firstComment!.id)).toHaveLength(0);
    expect(highlightsFor(secondComment!.id)).toHaveLength(2);
    await act(() =>
      draftStore.addReviewComment(threadRef, firstComment!, { insertAtCaret: false }),
    );
    expect(highlightsFor(firstComment!.id).length).toBeGreaterThan(0);
    await act(() => draftStore.setReviewComments(threadRef, []));
    expect(container.querySelectorAll("[data-paper-comment]")).toHaveLength(0);
    const proposal: PaperProposal = {
      id: "heading-proposal",
      threadId: threadRef.threadId,
      file: "main.tex",
      original: "\\paragraph{Limitations and future work.}",
      startLine: 10,
      endLine: 10,
      summary: "Choose a rewrite",
      options: [
        {
          latex:
            "A substantial revision needs enough space to read the complete passage. ".repeat(40) +
            String.raw` $\undefinedPaperMacro$`,
        },
        {
          latex: String.raw`The transform $\mathbf{T}_j\in\mathrm{SE}(3)$ is
\begin{equation}\mathbf{T}_j=\begin{bmatrix}\mathbf{R}_j&\mathbf{p}_j\\\mathbf{0}^{\top}&1\end{bmatrix}\label{eq:fk}\end{equation}`,
        },
      ],
      status: "pending",
      boxes: [],
      createdAt: "2026-10-19T00:00:00.000Z",
    };
    const reveal = (requestId: number) =>
      act(() =>
        root.render(
          <PdfViewer
            {...viewerProps}
            proposals={[proposal]}
            reveal={{ proposalId: proposal.id, requestId }}
          />,
        ),
      );
    await reveal(1);
    await vi.waitFor(() => {
      expect(onPageChange).toHaveBeenLastCalledWith(2, 2);
      expect(document.querySelector('[data-slot="popover-popup"]')?.textContent).toContain(
        "Choose a rewrite",
      );
    });
    const proposedPane = document.querySelector<HTMLElement>('[aria-label="Proposed text"] > div')!;
    expect(proposedPane.scrollHeight).toBeGreaterThan(proposedPane.clientHeight);
    expect(proposedPane.querySelector('[role="alert"]')?.textContent).toContain(
      "undefinedPaperMacro",
    );
    await act(() => userEvent.click(page.getByRole("button", { name: "Option B", exact: true })));
    expect(proposedPane.querySelector('[role="alert"]')).toBeNull();
    expect(proposedPane.querySelectorAll("math")).toHaveLength(2);
    expect(proposedPane.querySelector("math mtable")).not.toBeNull();
    await act(() => userEvent.keyboard("{Escape}"));
    await vi.waitFor(() =>
      expect(document.querySelector('[data-slot="popover-popup"]')).toBeNull(),
    );
    const heading = container.querySelector('[data-paper-page="2"] [data-paper-text-layer] span')!;
    await act(() => {
      const range = document.createRange();
      range.selectNodeContents(heading);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      const bounds = heading.getBoundingClientRect();
      heading.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      heading.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: bounds.x + bounds.width / 2,
          clientY: bounds.y + bounds.height / 2,
        }),
      );
    });
    expect(document.querySelector('[data-slot="popover-popup"]')).toBeNull();
    await expect.element(page.getByRole("button", { name: "Comment", exact: true })).toBeVisible();
    window.getSelection()!.removeAllRanges();
    await act(() => userEvent.click(page.elementLocator(heading)));
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="popover-popup"]')?.textContent).toContain(
        "Choose a rewrite",
      );
    });
    await act(() => userEvent.keyboard("{Escape}"));
    await act(() =>
      userEvent.click(
        page.getByRole("button", { name: "Review proposed change: Choose a rewrite" }),
      ),
    );
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="popover-popup"]')?.textContent).toContain(
        "Choose a rewrite",
      );
    });
    await act(() => userEvent.keyboard("{Escape}"));
    await reveal(2);
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="popover-popup"]')?.textContent).toContain(
        "Choose a rewrite",
      );
    });
    const store = useComposerDraftStore.getState();
    store.setContextInsertionHandler(threadRef, () => true);
    await act(() =>
      userEvent.fill(
        page.getByRole("textbox", { name: "Reply", exact: true }),
        "Replace only the final phrase.",
      ),
    );
    await act(() => userEvent.keyboard("{Enter}"));
    const draft = store.getComposerDraft(threadRef)!;
    const context = buildMessageContext({
      terminalContexts: [],
      previewAnnotations: [],
      reviewComments: draft.reviewComments,
    })!;
    const delivered = projectComposerContextForProvider({
      text: draft.prompt,
      records: context.records,
    });
    expect(delivered).toContain("Replace only the final phrase.");
    expect(delivered).toContain("Limitations and future work.");
  } finally {
    useComposerDraftStore.getState().setContextInsertionHandler(threadRef, null);
    useComposerDraftStore.getState().clearDraftThread(threadRef);
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
