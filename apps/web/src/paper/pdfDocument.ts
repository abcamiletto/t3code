import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useState } from "react";

GlobalWorkerOptions.workerSrc = workerUrl;

export interface PageSize {
  readonly width: number;
  readonly height: number;
}

export interface PaperDocument {
  readonly url: string;
  readonly pdf: PDFDocumentProxy;
  readonly pages: readonly PageSize[];
}

// Switching between a passage's alternatives should not reload documents, so recently shown
// ones stay parsed. Documents in use are never evicted.
const MAX_IDLE_DOCUMENTS = 4;
const documents = new Map<string, { readonly loading: Promise<PaperDocument>; users: number }>();

async function load(url: string): Promise<PaperDocument> {
  // One request for the whole file: a rebuild may replace it between range requests.
  const pdf = await getDocument({ url, disableRange: true, disableStream: true }).promise;
  const pages = await Promise.all(
    Array.from({ length: pdf.numPages }, async (_, index) => {
      const viewport = (await pdf.getPage(index + 1)).getViewport({ scale: 1 });
      return { width: viewport.width, height: viewport.height };
    }),
  );
  return { url, pdf, pages };
}

function retain(url: string) {
  const entry = documents.get(url) ?? { loading: load(url), users: 0 };
  entry.users++;
  // Re-insert, so the map stays ordered from least to most recently used.
  documents.delete(url);
  documents.set(url, entry);
  entry.loading.catch(() => documents.delete(url));
  return entry.loading;
}

function release(url: string) {
  const entry = documents.get(url);
  if (entry) entry.users--;
  const idle = [...documents].filter(([, candidate]) => candidate.users === 0);
  for (const [key, candidate] of idle.slice(0, Math.max(0, idle.length - MAX_IDLE_DOCUMENTS))) {
    documents.delete(key);
    void candidate.loading.then((document) => document.pdf.loadingTask.destroy());
  }
}

/** The PDF at `url`. Keeps returning the previous document until the next one has loaded. */
export function usePaperDocument(url: string | null) {
  const [state, setState] = useState<{
    readonly document: PaperDocument | null;
    readonly failedUrl: string | null;
  }>({ document: null, failedUrl: null });
  useEffect(() => {
    if (url === null) return;
    let active = true;
    retain(url).then(
      (document) => {
        if (active) setState({ document, failedUrl: null });
      },
      () => {
        if (active) setState((current) => ({ ...current, failedUrl: url }));
      },
    );
    return () => {
      active = false;
      release(url);
    };
  }, [url]);
  return {
    document: state.document,
    failed: url !== null && state.failedUrl === url,
  };
}
