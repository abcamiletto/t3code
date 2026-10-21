import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { useEnvironmentQuery } from "~/state/query";
import { PdfPage } from "./PdfPage";
import { readPaperDocument, type PaperDocument } from "./pdf";
import { paperEnvironment } from "./state";

const scale = 1.6;

export function ProposalPreview({
  latex,
  environmentId,
  cwd,
  proposalId,
  optionIndex,
  revision,
}: {
  latex: string;
  environmentId: EnvironmentId;
  cwd: string;
  proposalId: string;
  optionIndex: number | null;
  revision: number;
}) {
  const [preview, setPreview] = useState<
    | ({ source: string; updatedAt: number } & ({ document: PaperDocument } | { error: string }))
    | null
  >(null);
  const query = useEnvironmentQuery(
    latex.trim()
      ? paperEnvironment.preview({
          environmentId,
          input: { cwd, proposalId, optionIndex, revision },
        })
      : null,
  );
  const source = query.data?.pdf ?? null;
  const updatedAt = query.dataUpdatedAt;
  useEffect(() => {
    if (source === null) return;
    const controller = new AbortController();
    let document: PaperDocument | undefined;
    void readPaperDocument(
      Uint8Array.from(atob(source), (character) => character.charCodeAt(0)),
      controller.signal,
    )
      .then((pdf) => {
        if (controller.signal.aborted) {
          void pdf.pdf.loadingTask.destroy();
          return;
        }
        document = pdf;
        setPreview({ source, updatedAt, document: pdf });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setPreview({
            source,
            updatedAt,
            error: error instanceof Error ? error.message : "Could not display the preview PDF.",
          });
      });
    return () => {
      controller.abort();
      void document?.pdf.loadingTask.destroy();
    };
  }, [source, updatedAt]);
  const current = preview?.source === source && preview.updatedAt === updatedAt ? preview : null;
  const errors = query.data?.diagnostics.filter((entry) => entry.severity === "error") ?? [];
  const error =
    query.error ??
    (errors.length > 0 ? errors.map((entry) => entry.message).join("\n") : null) ??
    (current && "error" in current ? current.error : null);
  return (
    <div className="min-w-0">
      {!latex.trim() ? (
        <span className="text-xs text-muted-foreground">Passage removed.</span>
      ) : error ? (
        <div role="alert" className="flex flex-col gap-2 text-xs text-destructive">
          <span>LaTeX preview unavailable: {error}</span>
          <code className="overflow-x-auto font-mono whitespace-pre-wrap">{latex}</code>
          <div>
            <Button size="micro" variant="ghost" onClick={query.refresh}>
              Retry preview
            </Button>
          </div>
        </div>
      ) : current && "document" in current ? (
        <div className="overflow-x-auto" aria-label="Compiled LaTeX preview">
          {current.document.sizes.map((size, index) => (
            <div
              key={`${current.document.id}:${index + 1}`}
              className="relative"
              style={{ width: size.width * scale, height: size.height * scale }}
            >
              <PdfPage
                pdf={current.document.pdf}
                page={index + 1}
                layout={{ width: size.width * scale, height: size.height * scale, scale, top: 0 }}
                onReady={() => {}}
                onError={(error) =>
                  setPreview({
                    source: current.source,
                    updatedAt: current.updatedAt,
                    error:
                      error instanceof Error ? error.message : "Could not render the preview PDF.",
                  })
                }
              />
            </div>
          ))}
        </div>
      ) : (
        <span role="status" className="text-xs text-muted-foreground">
          Typesetting preview…
        </span>
      )}
    </div>
  );
}
