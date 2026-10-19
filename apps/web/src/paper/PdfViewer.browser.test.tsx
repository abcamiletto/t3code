import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { PdfViewer } from "./PdfViewer";
import pdfUrl from "./fixtures/comment.pdf?url";
import "../index.css";

it("keeps a PDF comment open when Shift is released and submits the complete draft", async () => {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;width:600px;height:400px";
  document.body.append(container);
  const root = createRoot(container);
  const onComment = vi.fn(async () => true);
  const threadRef = {
    environmentId: EnvironmentId.make("paper-test"),
    threadId: ThreadId.make("paper-thread"),
  };
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  try {
    await act(() =>
      root.render(
        <PdfViewer
          url={pdfUrl}
          zoom={1}
          assetError={null}
          cwd="/paper"
          threadRef={threadRef}
          composerDraftTarget={threadRef}
          proposals={[]}
          reveal={undefined}
          onPageChange={() => undefined}
          onComment={onComment}
        />,
      ),
    );
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
  } finally {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
