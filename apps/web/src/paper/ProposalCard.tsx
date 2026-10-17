import { useAtomValue } from "@effect/atom-react";
import type { PaperProposal, ScopedThreadRef } from "@t3tools/contracts";
import { formatEnvironmentQueryError } from "~/state/query";
import { Check, CircleCheck, CircleX, Clock3, X } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
import { useAtomCommand } from "~/state/use-atom-command";
import { TypesetText } from "./TypesetText";
import { PaperIconButton } from "./PaperIconButton";
import { paperReviewComment } from "./reviewComment";
import { paperEnvironment } from "./state";

export function ProposalCard({
  proposal,
  threadRef,
  cwd,
  composerDraftTarget = threadRef,
}: {
  proposal: PaperProposal;
  threadRef: ScopedThreadRef;
  cwd: string;
  composerDraftTarget?: ScopedThreadRef | DraftId;
}) {
  const [selected, setSelected] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState<PaperProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
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
          "Paper edit applied",
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
        "Paper proposal",
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
  };

  if (current.status !== "pending") {
    const Icon =
      current.status === "applied" ? CircleCheck : current.status === "stale" ? Clock3 : CircleX;
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        <span className="truncate">{current.summary ?? "Proposal"}</span>
        <span className="ml-auto capitalize">{current.status}</span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 text-sm"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)
          return;
        if (event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
        const index = Number(event.key) - 1;
        if (/^[1-9]$/.test(event.key) && index < proposal.options.length) {
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
        <PaperIconButton
          label="Dismiss"
          disabled={!canResolve || busy}
          onClick={() => void submit({ type: "dismiss" })}
        >
          <X />
        </PaperIconButton>
      </div>
      <div className="text-xs text-muted-foreground line-through">
        <TypesetText latex={proposal.original} />
      </div>
      <div role="radiogroup" aria-label="Options" className="flex flex-col gap-1">
        {proposal.options.map((option, index) => (
          <button
            key={option.latex}
            type="button"
            role="radio"
            aria-checked={selected === index}
            className="flex gap-2 rounded-md border border-transparent p-2 text-left aria-checked:border-primary/25 aria-checked:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => setSelected(index)}
          >
            <span className="text-xs text-muted-foreground">{String.fromCharCode(65 + index)}</span>
            <span className="flex min-w-0 flex-col gap-1">
              <TypesetText latex={option.latex} />
              {option.note && <span className="text-xs text-muted-foreground">{option.note}</span>}
            </span>
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <PaperIconButton
          label="Apply"
          disabled={!canResolve || busy || proposal.options.length === 0}
          onClick={() => void submit({ type: "apply", optionIndex: selected })}
        >
          <Check />
        </PaperIconButton>
      </div>
      <Textarea
        size="sm"
        aria-label="Reply to agent"
        placeholder="Reply to agent…"
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            reply();
          } else if (event.key === "Escape") {
            event.stopPropagation();
            setFeedback("");
          }
        }}
      />
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
