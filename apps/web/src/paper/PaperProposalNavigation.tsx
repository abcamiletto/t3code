import type { PaperState, ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PaperIconButton } from "./PaperIconButton";
import { revealPaperProposal, usePaperReveal } from "./openPaperPanel";

export function PaperProposalNavigation({
  state,
  threadRef,
}: {
  state: PaperState;
  threadRef: ScopedThreadRef;
}) {
  const reveal = usePaperReveal((value) => value.requests[scopedThreadKey(threadRef)]);
  const pending = state.proposals.filter((proposal) => proposal.status === "pending");
  const selectedIndex = pending.findIndex((proposal) => proposal.id === reveal?.proposalId);
  const index = selectedIndex < 0 ? 0 : selectedIndex;
  if (pending.length < 2) return null;
  const navigate = (offset: number) => {
    const next = pending[(index + offset + pending.length) % pending.length]!;
    revealPaperProposal(threadRef, next.id);
  };
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <PaperIconButton label="Previous proposal" onClick={() => navigate(-1)}>
        <ChevronLeft />
      </PaperIconButton>
      <span className="tabular-nums text-muted-foreground" aria-label="Proposal" aria-live="polite">
        {index + 1}/{pending.length}
      </span>
      <PaperIconButton label="Next proposal" onClick={() => navigate(1)}>
        <ChevronRight />
      </PaperIconButton>
    </div>
  );
}
