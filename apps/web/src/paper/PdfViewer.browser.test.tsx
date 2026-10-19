import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { PdfViewer } from "./PdfViewer";
import "../index.css";

it("keeps a PDF comment open when Shift is released and submits the complete draft", async () => {
  const content = "BT /F1 18 Tf 20 100 Td (An original sentence.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
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
          url={url}
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
    URL.revokeObjectURL(url);
    vi.unstubAllGlobals();
  }
});
