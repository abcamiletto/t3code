import { useAtomValue } from "@effect/atom-react";
import type { PaperProposal, ScopedThreadRef } from "@t3tools/contracts";
import { formatEnvironmentQueryError } from "~/state/query";
import { Check, CircleCheck, CircleX, Clock3, LocateFixed, X } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
import { dispatchSnapShotComposerFocus } from "~/lib/desktopSnapShot";
import { useAtomCommand } from "~/state/use-atom-command";
import { TypesetText } from "./TypesetText";
import { PaperIconButton } from "./PaperIconButton";
import { PAPER_SECTIONS, paperReviewComment } from "./reviewComment";
import { paperEnvironment } from "./state";
import { PaperReplyInput } from "./PaperReplyInput";
import { openPaperPanel } from "./openPaperPanel";

export function ProposalCard({
  proposal,
  threadRef,
  cwd,
  composerDraftTarget = threadRef,
  compact = false,
  showLocation = true,
  onClose,
}: {
  proposal: PaperProposal;
  threadRef: ScopedThreadRef;
  cwd: string;
  composerDraftTarget?: ScopedThreadRef | DraftId;
  compact?: boolean;
  showLocation?: boolean;
  onClose?: () => void;
}) {
  const [selected, setSelected] = useState(proposal.appliedOptionIndex ?? 0);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState<PaperProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [originalOpen, setOriginalOpen] = useState(!compact);
  const resolve = useAtomCommand(paperEnvironment.resolveProposal, { reportFailure: false });
  const canResolve = useAtomValue(
    paperEnvironment.resolveProposal.permissionAtom(threadRef.environmentId),
  );
  const addComment = useComposerDraftStore((state) => state.addReviewComment);
  const current = resolved ?? proposal;
  const choice = current.status === "applied" ? (current.appliedOptionIndex ?? selected) : selected;
  const option = proposal.options[choice]!;
  const locationAction = showLocation && (
    <Button
      size="micro"
      variant="ghost"
      onClick={() => openPaperPanel(threadRef, { proposalId: proposal.id })}
    >
      <LocateFixed />
      View in PDF
    </Button>
  );

  const submit = async (
    resolution: { type: "apply"; optionIndex: number } | { type: "dismiss" },
  ) => {
    if (busy || current.status !== "pending") return;
    setBusy(true);
    setError(null);
    const result = await resolve({
      environmentId: threadRef.environmentId,
      input: { cwd, proposalId: proposal.id, resolution },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      setError(formatEnvironmentQueryError(result.cause));
      return;
    }
    setResolved(result.value);
    if (resolution.type === "apply") {
      addComment(
        composerDraftTarget,
        paperReviewComment(
          proposal,
          PAPER_SECTIONS.applied,
          `Applied option ${String.fromCharCode(65 + resolution.optionIndex)}`,
          proposal.options[resolution.optionIndex]!.latex,
        ),
        { insertAtCaret: false },
      );
    }
  };

  const reply = () => {
    if (!feedback.trim()) return;
    addComment(
      composerDraftTarget,
      paperReviewComment(
        proposal,
        PAPER_SECTIONS.feedback,
        feedback,
        [
          proposal.original,
          ...proposal.options.map(
            (option, index) => `${String.fromCharCode(65 + index)}: ${option.latex}`,
          ),
        ].join("\n\n"),
      ),
      { insertAtCaret: false },
    );
    setFeedback("");
    dispatchSnapShotComposerFocus();
  };

  if (current.status !== "pending" && compact) {
    const Icon =
      current.status === "applied" ? CircleCheck : current.status === "stale" ? Clock3 : CircleX;
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        <span className="truncate">{current.summary ?? "Proposal"}</span>
        <span className="ml-auto capitalize">{current.status}</span>
        {locationAction}
      </div>
    );
  }

  return (
    <div
      className={compact ? "flex flex-col gap-2 text-sm" : "flex flex-col gap-3 text-sm"}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)
          return;
        if (event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
        if (current.status !== "pending") return;
        const index = Number(event.key) - 1;
        if (/^[1-4]$/.test(event.key) && index < proposal.options.length) {
          event.preventDefault();
          setSelected(index);
        } else if (event.key === "Enter" && canResolve && !busy && proposal.options.length > 0) {
          if (event.target instanceof Element && event.target.closest('button:not([role="radio"])'))
            return;
          event.preventDefault();
          void submit({ type: "apply", optionIndex: selected });
        }
      }}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">
          {proposal.summary ?? "Proposal"}
        </span>
        {current.status !== "pending" && (
          <span className="text-xs capitalize text-muted-foreground">{current.status}</span>
        )}
        {locationAction}
        {onClose && (
          <PaperIconButton label="Close proposal" onClick={onClose}>
            <X />
          </PaperIconButton>
        )}
      </div>
      {compact && (
        <div>
          <Button
            size="micro"
            variant="ghost"
            aria-expanded={originalOpen}
            onClick={() => setOriginalOpen((open) => !open)}
          >
            Original
          </Button>
        </div>
      )}
      <ToggleGroup
        aria-label="Options"
        disabled={current.status !== "pending"}
        value={[String(choice)]}
        onValueChange={([value]) => {
          if (value !== undefined) setSelected(Number(value));
        }}
      >
        {proposal.options.map((alternative, index) => (
          <Toggle key={alternative.latex} value={String(index)}>
            Option {String.fromCharCode(65 + index)}
          </Toggle>
        ))}
      </ToggleGroup>
      <div
        className={compact ? "flex min-h-0 flex-col gap-3" : "grid min-h-0 gap-3 sm:grid-cols-2"}
      >
        {originalOpen && (
          <section className="flex min-w-0 flex-col gap-2" aria-label="Original text">
            <h3 className="text-xs font-medium text-destructive">Before</h3>
            <div className="max-h-[min(48vh,28rem)] overflow-auto rounded-md border border-destructive/25 bg-destructive/5 p-3 text-base leading-relaxed wrap-anywhere">
              <TypesetText latex={proposal.original} />
            </div>
          </section>
        )}
        <section className="flex min-w-0 flex-col gap-2" aria-label="Proposed text">
          <h3 className="text-xs font-medium text-success-foreground">
            After · Option {String.fromCharCode(65 + choice)}
          </h3>
          <div className="max-h-[min(48vh,28rem)] overflow-auto rounded-md border border-success/25 bg-success/5 p-3 text-base leading-relaxed wrap-anywhere">
            <TypesetText latex={option.latex} />
          </div>
          {option.note && <p className="text-xs text-muted-foreground">{option.note}</p>}
        </section>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button
          size="xs"
          variant="ghost"
          disabled={!canResolve || busy || current.status !== "pending"}
          onClick={() => void submit({ type: "dismiss" })}
        >
          Dismiss
        </Button>
        <Button
          size="xs"
          variant="secondary"
          disabled={!canResolve || busy || current.status !== "pending"}
          onClick={() => void submit({ type: "apply", optionIndex: selected })}
        >
          <Check />
          Apply option {String.fromCharCode(65 + choice)}
        </Button>
      </div>
      <PaperReplyInput value={feedback} onChange={setFeedback} onSubmit={reply} />
      {feedback.trim() && (
        <div className="flex justify-end">
          <Button size="xs" variant="ghost" onClick={reply}>
            Reply
          </Button>
        </div>
      )}
      {error && (
        <div role="alert" className="text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
