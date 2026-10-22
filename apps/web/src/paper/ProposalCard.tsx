import type { PaperProposal, PaperProposalReference, ScopedThreadRef } from "@t3tools/contracts";
import { ChevronDown, FileText } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Toggle } from "~/components/ui/toggle";
import { useEnvironmentQuery } from "~/state/query";
import {
  choiceLabel,
  ProposalChoices,
  ProposalDiff,
  proposalStatusLabel,
  useProposalChoice,
} from "./ProposalParts";
import { ProposalFooter } from "./ProposalFooter";
import { openPaper, setExpanded, showTypeset, usePaperReview } from "./review";
import { paperEnvironment } from "./state";
import { TypesetChoice } from "./TypesetChoice";
import { useProposalActions } from "./useProposalActions";

/** The alternatives an agent proposed, where it proposed them in the chat. */
export default function ProposalCard(props: {
  readonly threadRef: ScopedThreadRef;
  readonly reference: PaperProposalReference;
}) {
  const { threadRef, reference } = props;
  const paper = useEnvironmentQuery(
    paperEnvironment.state({
      environmentId: threadRef.environmentId,
      input: { cwd: reference.cwd, threadId: threadRef.threadId },
    }),
  );
  const proposal = paper.data?.proposals.find((entry) => entry.id === reference.proposalId);
  if (!proposal) {
    // Nothing until the state arrives, so the row grows once instead of twice while streaming.
    if (!paper.data && !paper.error) return null;
    return (
      <div className="rounded-lg border px-3 py-2 text-xs text-muted-foreground">
        {paper.error ?? "This proposal is no longer available."}
      </div>
    );
  }
  return <LoadedProposalCard key={proposal.id} {...props} proposal={proposal} />;
}

function LoadedProposalCard(props: {
  readonly threadRef: ScopedThreadRef;
  readonly reference: PaperProposalReference;
  readonly proposal: PaperProposal;
}) {
  const { threadRef, reference, proposal } = props;
  const choice = useProposalChoice(proposal);
  const actions = useProposalActions(threadRef, reference.cwd, proposal);
  const resolved = proposal.status !== "pending";
  const expanded = usePaperReview((state) => state.expanded[proposal.id] ?? !resolved);
  const typeset = usePaperReview((state) => state.typeset[proposal.id] ?? false);
  const stale = proposal.status === "stale";
  const status = proposalStatusLabel(proposal);
  const location =
    proposal.startLine === proposal.endLine
      ? `${proposal.file}:${proposal.startLine}`
      : `${proposal.file}:${proposal.startLine}–${proposal.endLine}`;
  return (
    <section
      aria-label={proposal.summary ?? "Proposed rewrite"}
      className="flex flex-col gap-2.5 rounded-lg border bg-card px-3 py-2.5"
    >
      <header className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded(proposal.id, !expanded)}
        >
          <span className="truncate text-sm font-medium">
            {proposal.summary ?? "Proposed rewrite"}
          </span>
          {status ? <span className="shrink-0 text-xs text-muted-foreground">{status}</span> : null}
          <ChevronDown
            className={
              expanded
                ? "size-3.5 shrink-0 rotate-180 text-muted-foreground"
                : "size-3.5 shrink-0 text-muted-foreground"
            }
          />
        </button>
        <Button
          size="xs"
          variant="ghost"
          disabled={stale}
          onClick={() => openPaper(threadRef, proposal.id)}
        >
          <FileText />
          Show in paper
        </Button>
      </header>
      {expanded ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <ProposalChoices proposal={proposal} choice={choice} />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {location}
            </span>
            {stale ? null : (
              <Toggle
                size="xs"
                variant="ghost"
                pressed={typeset}
                onPressedChange={(pressed) => showTypeset(proposal.id, pressed)}
              >
                Typeset
              </Toggle>
            )}
          </div>
          {typeset && !stale ? (
            <TypesetChoice
              threadRef={threadRef}
              cwd={reference.cwd}
              proposal={proposal}
              choice={choice}
            />
          ) : (
            <ProposalDiff proposal={proposal} choice={choice} />
          )}
          {choice !== null && proposal.options[choice]?.note ? (
            <p className="text-xs text-muted-foreground">
              {choiceLabel(choice)}: {proposal.options[choice]!.note}
            </p>
          ) : null}
          <ProposalFooter
            proposal={proposal}
            choice={choice}
            actions={actions}
            composerDraftTarget={threadRef}
          />
        </>
      ) : null}
    </section>
  );
}
