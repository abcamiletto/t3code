import type { PaperProposal } from "@t3tools/contracts";

export function newLivePaperProposal(
  previousIds: ReadonlySet<string> | undefined,
  proposals: readonly PaperProposal[],
  threadId: string,
) {
  // The first snapshot contains history, including proposals from other clients.
  return previousIds === undefined
    ? undefined
    : proposals.findLast(
        (proposal) =>
          !previousIds.has(proposal.id) &&
          proposal.status === "pending" &&
          proposal.threadId === threadId,
      );
}
