import { TextLayer, type RenderTask } from "pdfjs-dist";
import { useEffect, useRef, type ReactNode } from "react";

import type { PaperDocument } from "./pdfDocument";
import "./textLayer.css";

/**
 * One page: a canvas with pdf.js's selectable text layer on top. A new document or scale paints
 * offscreen first, so switching between builds never flashes an empty page.
 */
export function PdfPage(props: {
  readonly document: PaperDocument;
  readonly page: number;
  readonly scale: number;
  readonly top: number;
  readonly children?: ReactNode;
}) {
  const { document, page, scale } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const size = document.pages[page - 1]!;
  // oxlint-disable-next-line t3code/react-effect-budget -- PDF.js owns canvas and text-layer DOM work and must cancel it on unmount.
  useEffect(() => {
    let cancelled = false;
    let render: RenderTask | undefined;
    let text: TextLayer | undefined;
    void document.pdf.getPage(page).then(async (proxy) => {
      if (cancelled) return;
      const viewport = proxy.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const offscreen = window.document.createElement("canvas");
      offscreen.width = Math.ceil(viewport.width * ratio);
      offscreen.height = Math.ceil(viewport.height * ratio);
      render = proxy.render({ canvas: offscreen, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await render.promise.catch(() => undefined);
      const canvas = canvasRef.current;
      const container = textRef.current;
      if (cancelled || !canvas || !container) return;
      canvas.width = offscreen.width;
      canvas.height = offscreen.height;
      canvas.getContext("2d")?.drawImage(offscreen, 0, 0);
      const layer = window.document.createElement("div");
      text = new TextLayer({
        textContentSource: proxy.streamTextContent(),
        container: layer,
        viewport,
      });
      await text.render().catch(() => undefined);
      if (cancelled) return;
      container.style.setProperty("--scale-factor", String(scale));
      container.style.setProperty("--total-scale-factor", String(scale * viewport.userUnit));
      container.replaceChildren(...layer.childNodes);
    });
    return () => {
      cancelled = true;
      render?.cancel();
      text?.cancel();
    };
  }, [document, page, scale]);
  return (
    <div
      data-paper-page={page}
      className="absolute left-1/2 -translate-x-1/2 bg-white shadow-sm ring-1 ring-black/5"
      style={{ top: props.top, width: size.width * scale, height: size.height * scale }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
      <div ref={textRef} data-paper-text-layer className="absolute inset-0 overflow-hidden" />
      {props.children}
    </div>
  );
}
