import type { PaperProposal, ScopedThreadRef } from "@t3tools/contracts";
import { MessageSquareReply } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
import { proposalFeedback } from "./comments";
import { ProposalActions } from "./ProposalParts";
import type { PaperChoice } from "./review";
import type { useProposalActions } from "./useProposalActions";

/** Reply, the last error, and the actions for a proposal, in its card and in the review bar. */
export function ProposalFooter(props: {
  readonly proposal: PaperProposal;
  readonly choice: PaperChoice;
  readonly actions: ReturnType<typeof useProposalActions>;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
}) {
  const [replying, setReplying] = useState(false);
  if (replying) return <ProposalReply {...props} onClose={() => setReplying(false)} />;
  return (
    <footer className="flex items-center justify-end gap-1">
      <Button size="xs" variant="ghost" className="mr-auto" onClick={() => setReplying(true)}>
        <MessageSquareReply />
        Reply
      </Button>
      {props.actions.error ? (
        <p role="alert" className="text-xs text-destructive">
          {props.actions.error}
        </p>
      ) : null}
      <ProposalActions proposal={props.proposal} choice={props.choice} actions={props.actions} />
    </footer>
  );
}

/** Feedback on a proposal, added to the message like a PDF comment. */
function ProposalReply(props: {
  readonly proposal: PaperProposal;
  readonly choice: PaperChoice;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  readonly onClose: () => void;
}) {
  const [text, setText] = useState("");
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const submit = () => {
    if (!text.trim()) return;
    addReviewComment(
      props.composerDraftTarget,
      proposalFeedback(props.proposal, props.choice, text),
      {
        insertAtCaret: false,
      },
    );
    props.onClose();
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        autoFocus
        size="sm"
        aria-label="Feedback for the agent"
        placeholder="What should the agent change?"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            props.onClose();
          } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex items-center justify-end gap-1">
        <Button size="xs" variant="ghost" onClick={props.onClose}>
          Cancel
        </Button>
        <Button size="xs" disabled={!text.trim()} onClick={submit}>
          Add to message
        </Button>
      </div>
    </div>
  );
}
