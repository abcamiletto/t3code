import type { PaperProposalReference, ScopedThreadRef } from "@t3tools/contracts";
import { PanelRightOpen } from "lucide-react";
import { useEnvironmentQuery } from "~/state/query";
import { PaperIconButton } from "./PaperIconButton";
import { ProposalCard } from "./ProposalCard";
import { openPaperPanel } from "./openPaperPanel";
import { paperEnvironment } from "./state";

export default function PaperProposalRow({
  threadRef,
  reference,
}: {
  threadRef: ScopedThreadRef;
  reference: PaperProposalReference;
}) {
  const query = useEnvironmentQuery(
    paperEnvironment.state({
      environmentId: threadRef.environmentId,
      input: { cwd: reference.cwd },
    }),
  );
  const proposal = query.data?.proposals.find((entry) => entry.id === reference.proposalId);
  return (
    <div className="min-w-0 rounded-lg border border-border p-3">
      {proposal ? (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          threadRef={threadRef}
          cwd={reference.cwd}
          compact
          actions={
            <PaperIconButton
              label="View in paper"
              onClick={() => openPaperPanel(threadRef, reference)}
            >
              <PanelRightOpen />
            </PaperIconButton>
          }
        />
      ) : (
        <div className="text-xs text-muted-foreground">
          {query.error ?? (query.data ? "Proposal unavailable" : "Loading proposal…")}
        </div>
      )}
    </div>
  );
}
