import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { PaperState, ScopedThreadRef } from "@t3tools/contracts";
import { resolveWorkspaceFilePath } from "@t3tools/shared/path";
import { ScrollText, Wrench } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useAssetUrlState } from "~/assets/assetUrls";
import { workspaceAssetResource } from "~/components/files/filePreviewMode";
import { Button } from "~/components/ui/button";
import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { PaperToolbar } from "./PaperToolbar";
import { usePaperReveal } from "./openPaperPanel";
import { PAPER_SECTIONS, paperReviewComment } from "./reviewComment";
import type { PaperSelection } from "./selection";
import { paperEnvironment } from "./state";

const PdfViewer = lazy(() =>
  import("./PdfViewer").then((module) => ({ default: module.PdfViewer })),
);

type PanelContext = {
  threadRef: ScopedThreadRef;
  cwd: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
};

function PaperPdf({
  state,
  zoom,
  onPageChange,
  onComment,
  reveal,
  ...context
}: PanelContext & {
  state: PaperState;
  zoom: number;
  onPageChange: (page: number, count: number) => void;
  onComment: (selection: PaperSelection, comment: string) => Promise<boolean>;
  reveal: { proposalId: string; requestId: number } | undefined;
}) {
  const resource =
    state.build.pdfPath === null
      ? null
      : workspaceAssetResource({
          kind: "workspace-file",
          threadRef: context.threadRef,
          draft: typeof context.composerDraftTarget === "string",
          workspaceRoot: context.cwd,
          absolutePath: resolveWorkspaceFilePath(state.build.pdfPath, context.cwd),
        });
  const asset = useAssetUrlState(context.threadRef.environmentId, resource);
  if (state.build.pdfPath === null) return <PaperEmpty label="No PDF" />;
  const url = asset._tag === "Success" ? new URL(asset.url) : null;
  url?.searchParams.set("revision", String(state.build.revision));
  return (
    <Suspense fallback={null}>
      <PdfViewer
        {...context}
        url={url?.href ?? null}
        assetError={asset._tag === "Failure" ? "PDF unavailable" : null}
        zoom={zoom}
        proposals={state.proposals}
        reveal={reveal}
        onPageChange={onPageChange}
        onComment={onComment}
      />
    </Suspense>
  );
}

function PaperEmpty({ label, compiler = false }: { label: string; compiler?: boolean }) {
  const Icon = compiler ? Wrench : ScrollText;
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-xs text-muted-foreground">
      <Icon className="size-5" />
      <span>{label}</span>
      {compiler && <code className="select-all text-xs">brew install tectonic</code>}
    </div>
  );
}

export default function PaperPanel(context: PanelContext) {
  const { threadRef, cwd, composerDraftTarget } = context;
  const environmentId = threadRef.environmentId;
  const query = useEnvironmentQuery(paperEnvironment.state({ environmentId, input: { cwd } }));
  const build = useAtomCommand(paperEnvironment.build, { reportFailure: false });
  const sync = useAtomCommand(paperEnvironment.syncFromPdf, { reportFailure: false });
  const canBuild = useAtomValue(paperEnvironment.build.permissionAtom(environmentId));
  const addComment = useComposerDraftStore((state) => state.addReviewComment);
  const reveal = usePaperReveal((state) => state.requests[scopedThreadKey(threadRef)]);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ page: 0, count: 0 });
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rebuild = async () => {
    setBusy(true);
    setError(null);
    const result = await build({ environmentId, input: { cwd } });
    setBusy(false);
    if (result._tag === "Failure") setError(formatEnvironmentQueryError(result.cause));
  };
  const comment = async (selection: PaperSelection, text: string) => {
    const result = await sync({
      environmentId,
      input: {
        cwd,
        page: selection.page,
        x: selection.x,
        y: selection.y,
        text: selection.text,
      },
    });
    if (result._tag === "Failure") {
      setError(formatEnvironmentQueryError(result.cause));
      return false;
    }
    const range = result.value;
    addComment(
      composerDraftTarget,
      paperReviewComment(
        range,
        PAPER_SECTIONS.comment,
        `${text.trim()}\n\nSelected PDF text (page ${selection.page}):\n${selection.text}`,
        range.source,
      ),
      { insertAtCaret: false },
    );
    setError(null);
    return true;
  };
  if (!query.data) return <PaperEmpty label={query.error ?? "Paper"} />;
  // The PDF is shared by the workspace; proposals belong to the active chat.
  const state = {
    ...query.data,
    proposals: query.data.proposals.filter((proposal) => proposal.threadId === threadRef.threadId),
  };
  const missing = state.build.diagnostics.some((entry) => entry.code === "compiler_missing");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaperToolbar
        state={state}
        threadRef={threadRef}
        page={position.page}
        pages={position.count}
        zoom={zoom}
        onZoom={setZoom}
        canBuild={canBuild}
        busy={busy}
        onBuild={() => void rebuild()}
        diagnosticsOpen={diagnosticsOpen}
        onDiagnostics={() => setDiagnosticsOpen((open) => !open)}
      />
      {state.build.status === "failed" && !missing && (
        <div
          role="alert"
          className="shrink-0 border-b border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          <p>
            Build failed.{" "}
            {state.build.pdfPath
              ? "Showing the previous PDF; latest changes are not displayed."
              : "No current PDF is available."}
          </p>
          <p>{state.build.diagnostics.find((entry) => entry.severity === "error")?.message}</p>
        </div>
      )}
      {diagnosticsOpen && (
        <div className="max-h-40 shrink-0 overflow-y-auto border-b border-border px-2 py-1">
          {state.build.diagnostics.map((diagnostic) => (
            <div
              key={`${diagnostic.file}:${diagnostic.line}:${diagnostic.message}`}
              className="flex gap-2 py-1 text-xs"
            >
              {diagnostic.file && (
                <Button
                  size="micro"
                  variant="ghost"
                  onClick={() => {
                    useRightPanelStore
                      .getState()
                      .openFile(threadRef, diagnostic.file!, diagnostic.line);
                  }}
                >
                  {diagnostic.file}
                  {diagnostic.line ? `:${diagnostic.line}` : ""}
                </Button>
              )}
              <span
                className={
                  diagnostic.severity === "error" ? "text-destructive" : "text-muted-foreground"
                }
              >
                {diagnostic.message}
              </span>
            </div>
          ))}
        </div>
      )}
      {!state.isLatex ? (
        <PaperEmpty label="No LaTeX document in this workspace" />
      ) : missing ? (
        <PaperEmpty label="LaTeX tools missing" compiler />
      ) : (
        <PaperPdf
          {...context}
          state={state}
          zoom={zoom}
          reveal={reveal}
          onComment={comment}
          onPageChange={(page, count) =>
            setPosition((current) =>
              current.page === page && current.count === count ? current : { page, count },
            )
          }
        />
      )}
      {(error || query.error) && !missing && (
        <div role="alert" className="border-t border-border px-3 py-2 text-xs text-destructive">
          {error ?? query.error}
        </div>
      )}
    </div>
  );
}
