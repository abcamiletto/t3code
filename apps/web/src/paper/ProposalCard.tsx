import { useAtomValue } from "@effect/atom-react";
import type { PaperProposal, ScopedThreadRef } from "@t3tools/contracts";
import { formatEnvironmentQueryError } from "~/state/query";
import { Check, CircleCheck, CircleX, Clock3, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
import { cn } from "~/lib/utils";
import { dispatchSnapShotComposerFocus } from "~/lib/desktopSnapShot";
import { useAtomCommand } from "~/state/use-atom-command";
import { TypesetText } from "./TypesetText";
import { PaperIconButton } from "./PaperIconButton";
import { PAPER_SECTIONS, paperReviewComment } from "./reviewComment";
import { paperEnvironment } from "./state";
import { PaperReplyInput } from "./PaperReplyInput";

export function ProposalCard({
  proposal,
  threadRef,
  cwd,
  composerDraftTarget = threadRef,
  compact = false,
  actions,
}: {
  proposal: PaperProposal;
  threadRef: ScopedThreadRef;
  cwd: string;
  composerDraftTarget?: ScopedThreadRef | DraftId;
  compact?: boolean;
  actions?: ReactNode;
}) {
  const [selected, setSelected] = useState(0);
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

  const submit = async (
    resolution: { type: "apply"; optionIndex: number } | { type: "dismiss" },
  ) => {
    if (busy) return;
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
    );
    setFeedback("");
    dispatchSnapShotComposerFocus();
  };

  if (current.status !== "pending") {
    const Icon =
      current.status === "applied" ? CircleCheck : current.status === "stale" ? Clock3 : CircleX;
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        <span className="truncate">{current.summary ?? "Proposal"}</span>
        <span className="ml-auto capitalize">{current.status}</span>
        {actions}
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
        {actions}
        <PaperIconButton
          label="Dismiss"
          disabled={!canResolve || busy}
          onClick={() => void submit({ type: "dismiss" })}
        >
          <X />
        </PaperIconButton>
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
      {originalOpen && (
        <div className="text-xs text-muted-foreground line-through">
          <TypesetText latex={proposal.original} />
        </div>
      )}
      <div role="radiogroup" aria-label="Options" className="flex flex-col gap-1">
        {proposal.options.map((option, index) => (
          <div
            key={option.latex}
            data-selected={selected === index}
            className={cn(
              "flex gap-2 rounded-md border border-transparent data-[selected=true]:border-border data-[selected=true]:bg-muted/40",
              compact ? "p-1.5" : "p-2",
            )}
          >
            <button
              type="button"
              role="radio"
              tabIndex={selected === index ? 0 : -1}
              aria-checked={selected === index}
              className="flex min-w-0 flex-1 cursor-pointer gap-2 text-left focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => setSelected(index)}
              onDoubleClick={() => {
                if (canResolve) void submit({ type: "apply", optionIndex: index });
              }}
            >
              <span className="text-xs text-muted-foreground">
                {String.fromCharCode(65 + index)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <TypesetText latex={option.latex} />
                {option.note && (
                  <span className="text-xs text-muted-foreground">{option.note}</span>
                )}
              </span>
            </button>
            {selected === index && (
              <span className="shrink-0 self-end">
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={!canResolve || busy}
                  onClick={() => void submit({ type: "apply", optionIndex: index })}
                >
                  <Check />
                  Apply
                </Button>
              </span>
            )}
          </div>
        ))}
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
