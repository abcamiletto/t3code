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

it("keeps comments open while typing and reveals proposals at their PDF passage", async () => {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;width:600px;height:400px";
  document.body.append(container);
  const root = createRoot(container);
  const onComment = vi.fn(async () => true);
  const onPageChange = vi.fn();
  const threadRef = {
    environmentId: EnvironmentId.make("paper-test"),
    threadId: ThreadId.make("paper-thread"),
  };
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
          latex: "A substantial revision needs enough space to read the complete passage. ".repeat(
            40,
          ),
        },
        { latex: "Limitations and next steps." },
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
    await act(() => userEvent.click(page.getByRole("button", { name: "Option B", exact: true })));
    expect(proposedPane.textContent).toBe("Limitations and next steps.");
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
