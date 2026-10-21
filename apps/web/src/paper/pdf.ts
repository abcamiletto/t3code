import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PageSize } from "./geometry";

GlobalWorkerOptions.workerSrc = workerUrl;

export interface PaperDocument {
  id: string;
  pdf: Awaited<ReturnType<typeof getDocument>["promise"]>;
  sizes: PageSize[];
}

export async function readPaperDocument(
  source: string | Uint8Array,
  signal: AbortSignal,
): Promise<PaperDocument> {
  const task = getDocument(typeof source === "string" ? { url: source } : { data: source });
  const abort = () => {
    void task.destroy();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const pdf = await task.promise;
    const sizes = await Promise.all(
      Array.from({ length: pdf.numPages }, async (_, index) => {
        const page = await pdf.getPage(index + 1);
        const viewport = page.getViewport({ scale: 1 });
        return { width: viewport.width, height: viewport.height };
      }),
    );
    return { id: typeof source === "string" ? source : pdf.fingerprints.join("-"), pdf, sizes };
  } catch (error) {
    await task.destroy();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
