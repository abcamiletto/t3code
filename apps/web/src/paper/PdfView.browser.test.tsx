import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../test/render";
import "../index.css";
import pdfUrl from "./fixtures/selection.pdf?url";
import { usePaperDocument } from "./pdfDocument";
import { PdfView, type PdfMark, type PdfTextSelection } from "./PdfView";

function Viewer(props: {
  readonly marks: readonly PdfMark[];
  readonly onSelectText: (selection: PdfTextSelection | null) => void;
}) {
  const { document } = usePaperDocument(pdfUrl);
  return document ? (
    <PdfView
      document={document}
      zoom={1}
      marks={props.marks}
      anchor={null}
      onPageChange={() => undefined}
      onSelectText={props.onSelectText}
    />
  ) : null;
}

const renderViewer = (props: Parameters<typeof Viewer>[0]) => {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;flex-direction:column;width:612px;height:500px";
  // The viewer has no routes.
  return render(<Viewer {...props} />, { container, router: false });
};

it("turns a text selection into boxes in PDF points", async () => {
  const onSelectText = vi.fn<(selection: PdfTextSelection | null) => void>();
  await using _screen = await renderViewer({ marks: [], onSelectText });
  await expect.element(page.getByText("Paper turns a selection into a comment.")).toBeVisible();
  const span = [...document.querySelectorAll("[data-paper-text-layer] span")].find((node) =>
    node.textContent?.includes("selection"),
  )!;
  const range = document.createRange();
  range.selectNodeContents(span.firstChild!);
  getSelection()!.removeAllRanges();
  getSelection()!.addRange(range);
  span.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

  const selection = onSelectText.mock.lastCall?.[0];
  expect(selection?.text).toContain("selection");
  // The article class centres a 345 pt text block on the page and indents a paragraph by 15 pt.
  const [box] = selection?.boxes ?? [];
  expect(box?.page).toBe(1);
  expect(box?.x).toBeGreaterThan(145);
  expect(box?.x).toBeLessThan(152);
  expect(box?.y).toBeGreaterThan(110);
  expect(box?.y).toBeLessThan(130);
});

it("opens a proposal from its margin marker", async () => {
  const onActivate = vi.fn();
  await using _screen = await renderViewer({
    marks: [
      {
        key: "proposal",
        boxes: [{ page: 1, x: 133, y: 117, width: 180, height: 10 }],
        tone: "proposal",
        label: "Review: shorter sentence",
        onActivate,
      },
    ],
    onSelectText: () => undefined,
  });
  await page.getByRole("button", { name: "Review: shorter sentence" }).click();
  expect(onActivate).toHaveBeenCalledOnce();
});
