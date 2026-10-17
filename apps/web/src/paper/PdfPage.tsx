import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import { useEffect, useEffectEvent, useRef } from "react";
import type { PageLayout } from "./geometry";
import "./textLayer.css";

export function PdfPage({
  pdf,
  page,
  layout,
  onReady,
  onError,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  layout: PageLayout;
  onReady: (page: number, rendered: boolean) => void;
  onError: (error: unknown) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const ready = useEffectEvent(onReady);
  const failed = useEffectEvent(onError);
  const scale = layout.scale;
  useEffect(() => {
    const canvas = canvasRef.current!;
    const container = textRef.current!;
    let cancelled = false;
    let render: RenderTask | undefined;
    let text: TextLayer | undefined;
    void pdf
      .getPage(page)
      .then(async (pdfPage) => {
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale });
        const ratio = window.devicePixelRatio;
        canvas.width = Math.ceil(viewport.width * ratio);
        canvas.height = Math.ceil(viewport.height * ratio);
        render = pdfPage.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        container.replaceChildren();
        container.style.setProperty("--scale-factor", String(scale));
        container.style.setProperty("--total-scale-factor", String(scale * viewport.userUnit));
        text = new TextLayer({
          container,
          viewport,
          textContentSource: pdfPage.streamTextContent(),
        });
        await Promise.all([render.promise, text.render()]);
        if (!cancelled) ready(page, true);
      })
      .catch((error: unknown) => {
        if (!cancelled) failed(error);
      });
    return () => {
      cancelled = true;
      ready(page, false);
      render?.cancel();
      text?.cancel();
    };
  }, [pdf, page, scale]);
  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div ref={textRef} data-paper-text-layer className="absolute inset-0 overflow-hidden" />
    </>
  );
}
