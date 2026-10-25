import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  PaperDiagnostic,
  PaperPdfBox,
  PaperProposal,
  PaperState,
  ScopedThreadRef,
} from "@t3tools/contracts";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Minus,
  Plus,
  RotateCw,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { FileSurfaceLoading } from "~/components/files/fileSurfaceChrome";
import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { usePaperDocument, usePaperFileUrl, type PaperDocument } from "./pdfDocument";
import { PdfView, type PdfMark, type PdfTextSelection } from "./PdfView";
import { pdfComment } from "./comments";
import { matchPassage, readTextRuns } from "./passage";
import { ProposalFooter } from "./ProposalFooter";
import {
  choiceLabel,
  choiceText,
  currentChoice,
  ProposalChoices,
  proposalStatusLabel,
  useProposalChoice,
} from "./ProposalParts";
import {
  chooseOption,
  focusProposal,
  keepPreview,
  markComment,
  previewKey,
  usePaperReview,
  type PaperChoice,
} from "./review";
import { SelectionComment } from "./SelectionComment";
import { paperEnvironment } from "./state";
import { useProposalActions } from "./useProposalActions";

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

interface PanelProps {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
}

/** The live PDF of the workspace's LaTeX document, and this thread's proposals on it. */
export default function PaperPanel(props: PanelProps) {
  const { threadRef, cwd } = props;
  const paper = useEnvironmentQuery(
    paperEnvironment.state({
      environmentId: threadRef.environmentId,
      input: { cwd, threadId: threadRef.threadId },
    }),
  );
  if (!paper.data) {
    return paper.error ? (
      <PaperMessage title="Paper is unavailable" detail={paper.error} />
    ) : (
      <FileSurfaceLoading />
    );
  }
  return <PaperWorkspace {...props} state={paper.data} />;
}

function PaperWorkspace(props: PanelProps & { readonly state: PaperState }) {
  const { threadRef, cwd, composerDraftTarget, state } = props;
  const { build } = state;
  const environmentId = threadRef.environmentId;
  const threadKey = scopedThreadKey(threadRef);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [selection, setSelection] = useState<PdfTextSelection | null>(null);
  // Outlives the selection, so adjusting what is selected keeps what was typed.
  const [draft, setDraft] = useState("");

  const focus = usePaperReview((review) => review.focused[threadKey]);
  const focused = state.proposals.find((proposal) => proposal.id === focus?.proposalId);
  const choice = useProposalChoice(focused);
  const variant =
    focused !== undefined && focused.status !== "stale" && choice !== currentChoice(focused);
  const preview = useEnvironmentQuery(
    variant && focused
      ? paperEnvironment.preview({
          environmentId,
          input: { cwd, proposalId: focused.id, option: choice, revision: build.revision },
        })
      : null,
  );
  const fresh = variant && preview.data?.status === "ready" ? preview.data : null;
  const failure = !variant
    ? null
    : (preview.error ??
      (preview.data?.status === "failed"
        ? (firstError(preview.data.diagnostics) ?? "It does not compile.")
        : null));
  const shownKey = focused ? previewKey(focused.id, choice) : null;
  const kept = usePaperReview((review) => (shownKey ? review.previews[shownKey] : undefined));
  useEffect(() => {
    if (fresh && shownKey) keepPreview(shownKey, fresh);
  }, [fresh, shownKey]);
  // A rebuild typesets the choice again; until then the last version stays on screen.
  const ready = fresh ?? (variant && failure === null ? (kept ?? null) : null);
  const typesetting = variant && ready === null && failure === null;
  const updating = ready !== null && fresh === null;
  const shownPdf = ready?.pdf ?? build.pdf;
  // Preview files are named per build; only the main PDF needs a cache-busting revision.
  const url = usePaperFileUrl(
    threadRef,
    cwd,
    composerDraftTarget,
    shownPdf,
    ready ? 0 : build.revision,
  );
  const { document, failed } = usePaperDocument(url);

  const reviewComments = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.reviewComments,
  );
  const commentMarks = usePaperReview((review) => review.comments);
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const locateSource = useAtomCommand(paperEnvironment.locateSource, { reportFailure: false });

  // SyncTeX boxes cover the passage's source lines; the anchor uses them because they do not move
  // when the passage is narrowed to its own words.
  const focusBoxes = ready ? ready.boxes : (focused?.boxes ?? []);
  const passage = usePassageBoxes(
    document?.url === url ? document : null,
    focusBoxes,
    focused ? choiceText(focused, ready ? choice : currentChoice(focused)) : null,
  );
  const showingBuild = shownPdf === build.pdf;
  const marks: PdfMark[] = [
    ...(showingBuild
      ? state.proposals
          .filter((proposal) => proposal.status === "pending" && proposal.id !== focused?.id)
          .map((proposal) => ({
            key: proposal.id,
            boxes: proposal.boxes,
            tone: "proposal" as const,
            label: `Review: ${proposal.summary ?? "proposed rewrite"}`,
            onActivate: () => focusProposal(threadRef, proposal.id),
          }))
      : []),
    ...(showingBuild
      ? (reviewComments ?? []).flatMap((comment) => {
          const mark = commentMarks[comment.id];
          return mark?.revision === build.revision
            ? [{ key: comment.id, boxes: mark.boxes, tone: "comment" as const }]
            : [];
        })
      : []),
    ...(focused
      ? [
          {
            key: `focus:${focused.id}`,
            boxes: passage === undefined ? [] : (passage ?? focusBoxes),
            tone: "focus" as const,
          },
        ]
      : []),
    // The native selection disappears while the comment form has focus.
    ...(selection ? [{ key: "selection", boxes: selection.boxes, tone: "comment" as const }] : []),
  ];
  const anchorBox: PaperPdfBox | undefined = focusBoxes[0];
  const anchor =
    focused && focus && anchorBox
      ? { key: `${focused.id}:${focus.request}`, box: anchorBox }
      : null;

  const closeComment = () => {
    setSelection(null);
    setDraft("");
  };

  const comment = async () => {
    if (!selection) return null;
    const result = await locateSource({
      environmentId,
      input: { cwd, boxes: selection.boxes },
    });
    if (result._tag === "Failure") return formatEnvironmentQueryError(result.cause);
    const reviewComment = pdfComment(result.value, draft, selection.text);
    addReviewComment(composerDraftTarget, reviewComment, { insertAtCaret: false });
    markComment(reviewComment.id, { revision: build.revision, boxes: selection.boxes });
    window.getSelection()?.removeAllRanges();
    closeComment();
    return null;
  };

  let body: ReactNode;
  if (state.mainFile === null) {
    body = (
      <PaperMessage
        title="No LaTeX document"
        detail="Paper builds the .tex file with \documentclass in the workspace root."
      />
    );
  } else if (build.status === "unavailable") {
    body = <MissingCompiler />;
  } else if (document) {
    body = (
      <PdfView
        document={document}
        zoom={zoom}
        marks={marks}
        anchor={anchor}
        onPageChange={setPage}
        onSelectText={(next) => {
          // Comments locate their source in the build's PDF, not in a typeset alternative.
          if (!showingBuild) return;
          // A click elsewhere dismisses an empty form but never discards typed text.
          if (next !== null) setSelection(next);
          else if (!draft.trim()) setSelection(null);
        }}
      >
        {selection ? (
          <SelectionComment
            key={`${selection.end.x}:${selection.end.y}`}
            selection={selection}
            text={draft}
            onTextChange={setDraft}
            onSubmit={comment}
            onCancel={closeComment}
          />
        ) : null}
      </PdfView>
    );
  } else if (failed) {
    body = <PaperMessage title="Could not open the PDF" detail="Rebuild to try again." />;
  } else if (build.pdf === null && build.status === "failed") {
    body = (
      <PaperMessage
        title="The paper does not compile yet"
        detail={firstError(build.diagnostics) ?? "The build produced no PDF."}
      />
    );
  } else {
    body = <FileSurfaceLoading />;
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(event) => {
        if (
          !focused ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLInputElement
        )
          return;
        const choices: PaperChoice[] = [null, ...focused.options.map((_, index) => index)];
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (step === 0) return;
        event.preventDefault();
        chooseOption(
          focused.id,
          choices[(choices.indexOf(choice) + step + choices.length) % choices.length]!,
        );
      }}
    >
      <PaperToolbar
        threadRef={threadRef}
        cwd={cwd}
        state={state}
        page={page}
        pages={document?.pages.length ?? 0}
        zoom={zoom}
        onZoom={setZoom}
        problemsOpen={problemsOpen}
        onToggleProblems={() => setProblemsOpen((open) => !open)}
        reviewing={focused !== undefined}
      />
      {problemsOpen && build.diagnostics.length > 0 ? (
        <Problems threadRef={threadRef} diagnostics={build.diagnostics} />
      ) : null}
      {variant ? (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/50 px-3 py-1.5 text-xs"
        >
          <span>
            Previewing {choiceLabel(choice).toLowerCase()}. This is not the current paper.
          </span>
          <Button size="xs" variant="ghost" onClick={() => focusProposal(threadRef, null)}>
            Return to current paper
          </Button>
        </div>
      ) : null}
      {failed && document ? (
        <div role="alert" className="shrink-0 border-b px-3 py-1.5 text-xs text-destructive">
          Could not load the latest PDF. The previous PDF is still shown; rebuild to try again.
        </div>
      ) : null}
      {build.outdated && build.pdf !== null ? (
        <div
          role="status"
          className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-3 py-1.5 text-xs text-destructive"
        >
          The last build failed, so the PDF does not show the latest changes.
        </div>
      ) : null}
      {body}
      {focused ? (
        <ProposalReview
          threadRef={threadRef}
          composerDraftTarget={composerDraftTarget}
          cwd={cwd}
          proposals={state.proposals}
          proposal={focused}
          choice={choice}
          typesetting={typesetting}
          updating={updating}
          failure={failure}
        />
      ) : null}
      {focused?.status === "pending"
        ? focused.options.map((option, index) =>
            index === choice ? null : (
              <PreviewPrefetch
                key={option.latex}
                threadRef={threadRef}
                cwd={cwd}
                proposalId={focused.id}
                option={index}
                revision={build.revision}
              />
            ),
          )
        : null}
    </div>
  );
}

/**
 * The passage's own words within its SyncTeX region, once the page text has been read; `null`
 * when they cannot be found there.
 */
function usePassageBoxes(
  document: PaperDocument | null,
  region: readonly PaperPdfBox[],
  latex: string | null,
) {
  // By value: a rebuild delivers equal boxes in new arrays.
  const key =
    document && latex !== null && region.length > 0
      ? JSON.stringify([document.url, latex, region])
      : null;
  const [found, setFound] = useState<{
    readonly key: string;
    readonly boxes: PaperPdfBox[] | null;
  } | null>(null);
  useEffect(() => {
    if (key === null || document === null) return;
    const [, text, boxes] = JSON.parse(key) as [string, string, PaperPdfBox[]];
    let active = true;
    void readTextRuns(document.pdf, boxes)
      .then(
        (runs) => matchPassage(runs, boxes, text),
        () => null,
      )
      .then((matched) => {
        if (active) setFound({ key, boxes: matched });
      });
    return () => {
      active = false;
    };
  }, [key, document]);
  // `undefined` while the page text is read, so the whole region never flashes up first.
  return found !== null && found.key === key ? found.boxes : undefined;
}

/** Typesets the other options in the background, so switching to them is instant. */
function PreviewPrefetch(props: {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string;
  readonly proposalId: string;
  readonly option: number;
  readonly revision: number;
}) {
  useAtomValue(
    paperEnvironment.preview({
      environmentId: props.threadRef.environmentId,
      input: {
        cwd: props.cwd,
        proposalId: props.proposalId,
        option: props.option,
        revision: props.revision,
      },
    }),
  );
  return null;
}

function PaperToolbar(props: {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string;
  readonly state: PaperState;
  readonly page: number;
  readonly pages: number;
  readonly zoom: number;
  readonly onZoom: (zoom: number) => void;
  readonly problemsOpen: boolean;
  readonly onToggleProblems: () => void;
  readonly reviewing: boolean;
}) {
  const { state, zoom, onZoom } = props;
  const { build } = state;
  const environmentId = props.threadRef.environmentId;
  const rebuild = useAtomCommand(paperEnvironment.build);
  const canBuild = useAtomValue(paperEnvironment.build.permissionAtom(environmentId));
  const errors = build.diagnostics.filter((entry) => entry.severity === "error").length;
  const warnings = build.diagnostics.length - errors;
  const zoomIndex = ZOOM_STEPS.findIndex((step) => step >= zoom);
  const pending = state.proposals.filter((proposal) => proposal.status === "pending");
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-2 text-xs">
      <BuildStatus
        state={state}
        errors={errors}
        warnings={warnings}
        problemsOpen={props.problemsOpen}
        onToggleProblems={props.onToggleProblems}
      />
      <span className="min-w-0 flex-1" />
      {!props.reviewing && pending.length > 0 ? (
        // New proposals wait here instead of moving the view while the author reads.
        <Button
          size="xs"
          variant="outline"
          onClick={() => focusProposal(props.threadRef, pending.at(-1)!.id)}
        >
          Review {pending.length === 1 ? "proposal" : `${pending.length} proposals`}
        </Button>
      ) : null}
      {props.pages > 0 ? (
        <span className="shrink-0 px-1 text-muted-foreground tabular-nums">
          {props.page} / {props.pages}
        </span>
      ) : null}
      <ToolbarButton
        label="Zoom out"
        disabled={zoomIndex <= 0}
        onClick={() => onZoom(ZOOM_STEPS[Math.max(0, zoomIndex - 1)]!)}
      >
        <Minus />
      </ToolbarButton>
      <Button size="xs" variant="ghost" aria-label="Fit to width" onClick={() => onZoom(1)}>
        <span className="w-8 tabular-nums">{Math.round(zoom * 100)}%</span>
      </Button>
      <ToolbarButton
        label="Zoom in"
        disabled={zoomIndex >= ZOOM_STEPS.length - 1}
        onClick={() => onZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, zoomIndex + 1)]!)}
      >
        <Plus />
      </ToolbarButton>
      <ToolbarButton
        label="Rebuild"
        disabled={!canBuild || build.status === "building"}
        onClick={() => void rebuild({ environmentId, input: { cwd: props.cwd } })}
      >
        <RotateCw />
      </ToolbarButton>
    </div>
  );
}

function BuildStatus(props: {
  readonly state: PaperState;
  readonly errors: number;
  readonly warnings: number;
  readonly problemsOpen: boolean;
  readonly onToggleProblems: () => void;
}) {
  const { state, errors, warnings } = props;
  const { build } = state;
  const name = state.mainFile ?? "Paper";
  let icon: ReactNode;
  let label: string;
  if (build.status === "building") {
    icon = <Spinner size="sm" tone="muted" />;
    label = "Building…";
  } else if (build.status === "unavailable") {
    icon = <TriangleAlert className="text-warning" />;
    label = "Tectonic is not installed";
  } else if (errors > 0) {
    icon = <CircleAlert className="text-destructive" />;
    label = errors === 1 ? "1 error" : `${errors} errors`;
  } else if (warnings > 0) {
    icon = <TriangleAlert className="text-warning" />;
    label = warnings === 1 ? "1 warning" : `${warnings} warnings`;
  } else if (build.status === "succeeded") {
    icon = <CircleCheck className="text-success" />;
    label =
      build.durationMs === undefined ? "Built" : `Built in ${formatSeconds(build.durationMs)}`;
  } else {
    icon = null;
    label = "";
  }
  const hasProblems = build.diagnostics.length > 0;
  return (
    <Button
      size="xs"
      variant="ghost"
      className="min-w-0"
      disabled={!hasProblems}
      aria-expanded={hasProblems ? props.problemsOpen : undefined}
      onClick={props.onToggleProblems}
    >
      <span className="truncate font-medium text-foreground">{name}</span>
      {icon}
      <span className="shrink-0 text-muted-foreground">{label}</span>
    </Button>
  );
}

function Problems(props: {
  readonly threadRef: ScopedThreadRef;
  readonly diagnostics: readonly PaperDiagnostic[];
}) {
  return (
    <ul className="max-h-48 shrink-0 overflow-y-auto border-b border-border/60 py-1 text-xs">
      {props.diagnostics.map((diagnostic) => (
        <li
          key={`${diagnostic.severity}:${diagnostic.file}:${diagnostic.line}:${diagnostic.message}`}
          className="flex items-start gap-2 px-3 py-1"
        >
          {diagnostic.severity === "error" ? (
            <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          ) : (
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
          )}
          <span className="min-w-0 flex-1 wrap-anywhere">{diagnostic.message}</span>
          {diagnostic.file ? (
            <Button
              size="micro"
              variant="ghost-muted"
              className="shrink-0"
              onClick={() =>
                useRightPanelStore
                  .getState()
                  .openFile(props.threadRef, diagnostic.file!, diagnostic.line)
              }
            >
              {diagnostic.file}
              {diagnostic.line ? `:${diagnostic.line}` : ""}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ProposalReview(props: {
  readonly threadRef: ScopedThreadRef;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  readonly cwd: string;
  readonly proposals: readonly PaperProposal[];
  readonly proposal: PaperProposal;
  readonly choice: PaperChoice;
  readonly typesetting: boolean;
  /** An older typesetting is on screen while the current build's is made. */
  readonly updating: boolean;
  readonly failure: string | null;
}) {
  const { threadRef, proposal, choice } = props;
  const actions = useProposalActions(threadRef, props.cwd, proposal);
  const pending = props.proposals.filter(
    (entry) => entry.status === "pending" || entry.id === proposal.id,
  );
  const index = pending.findIndex((entry) => entry.id === proposal.id);
  const go = (step: number) =>
    focusProposal(threadRef, pending[(index + step + pending.length) % pending.length]!.id);
  const status = proposalStatusLabel(proposal);
  const note = choice === null ? null : proposal.options[choice]?.note;
  return (
    <section
      aria-label="Proposal review"
      className="flex shrink-0 flex-col gap-2 border-t border-border/60 bg-background px-3 py-2.5"
    >
      <header className="flex min-w-0 items-center gap-1">
        {pending.length > 1 ? (
          <>
            <ToolbarButton label="Previous proposal" onClick={() => go(-1)}>
              <ChevronLeft />
            </ToolbarButton>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {index + 1} / {pending.length}
            </span>
            <ToolbarButton label="Next proposal" onClick={() => go(1)}>
              <ChevronRight />
            </ToolbarButton>
          </>
        ) : null}
        <span className="ml-1 min-w-0 flex-1 truncate text-sm font-medium">
          {proposal.summary ?? "Proposed rewrite"}
        </span>
        {status ? <span className="shrink-0 text-xs text-muted-foreground">{status}</span> : null}
        <ToolbarButton label="Close review" onClick={() => focusProposal(threadRef, null)}>
          <X />
        </ToolbarButton>
      </header>
      {proposal.status === "stale" ? (
        <p className="text-xs text-muted-foreground">
          The original text no longer appears exactly once in {proposal.file}.
        </p>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ProposalChoices proposal={proposal} choice={choice} />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {props.typesetting ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner size="xs" />
                Typesetting {choiceLabel(choice).toLowerCase()}…
              </span>
            ) : props.updating ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner size="xs" tone="muted" />
                Updating for the latest edits…
              </span>
            ) : props.failure ? (
              <span className="text-destructive">
                {choiceLabel(choice)} does not compile: {props.failure}
              </span>
            ) : (
              note
            )}
          </span>
        </div>
      )}
      <ProposalFooter
        proposal={proposal}
        choice={choice}
        actions={actions}
        composerDraftTarget={props.composerDraftTarget}
      />
    </section>
  );
}

function ToolbarButton(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={props.label}
            disabled={props.disabled ?? false}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function PaperMessage(props: { readonly title: string; readonly detail: string }) {
  return (
    <Empty size="compact">
      <EmptyHeader>
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{props.detail}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function MissingCompiler() {
  return (
    <Empty size="compact">
      <EmptyHeader>
        <EmptyTitle>Install Tectonic</EmptyTitle>
        <EmptyDescription>
          Paper builds with Tectonic. Install it on the machine that runs this project, then
          rebuild.
        </EmptyDescription>
      </EmptyHeader>
      <code className="rounded-md bg-muted px-2 py-1 text-xs select-all">
        brew install tectonic
      </code>
    </Empty>
  );
}

const firstError = (diagnostics: readonly PaperDiagnostic[]) => {
  const error = diagnostics.find((entry) => entry.severity === "error");
  return error
    ? `${error.message}${error.file ? ` (${error.file}${error.line ? `:${error.line}` : ""})` : ""}`
    : null;
};

const formatSeconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
