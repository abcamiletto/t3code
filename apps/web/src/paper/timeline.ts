import type { OrchestrationV2TurnItem, PaperProposalReference, RunId } from "@t3tools/contracts";
import * as ProposalLinks from "@t3tools/shared/paperProposalLinks";
import type { TimelineEntry } from "~/session-logic";
import { paperProposalFromToolItem } from "@t3tools/shared/toolOutput";

export interface PaperProposalTimelineRow {
  readonly kind: "paper-proposal";
  readonly id: string;
  readonly createdAt: string;
  readonly paperProposal: PaperProposalReference;
}

export interface PaperProposalTimelineEntry extends PaperProposalTimelineRow {
  readonly runId: RunId | null;
}

export function paperProposalTimelineEntry(
  item: OrchestrationV2TurnItem,
  createdAt: string,
): PaperProposalTimelineEntry | undefined {
  if (item.type !== "dynamic_tool" || item.status !== "completed") return;
  const paperProposal = paperProposalFromToolItem(item);
  if (paperProposal)
    return { kind: "paper-proposal", id: item.id, createdAt, runId: item.runId, paperProposal };
}

export function paperProposalRowsEqual(a: PaperProposalTimelineRow, b: PaperProposalTimelineRow) {
  return (
    a.createdAt === b.createdAt &&
    a.paperProposal.cwd === b.paperProposal.cwd &&
    a.paperProposal.proposalId === b.paperProposal.proposalId
  );
}

export function standalonePaperProposalIds(
  entries: readonly TimelineEntry[],
  collapsedEntryIds: ReadonlySet<string>,
  collapsedSupersededEntryIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const inline = new Set(
    entries.flatMap((entry) =>
      entry.kind === "message" &&
      entry.message.role === "assistant" &&
      !collapsedEntryIds.has(entry.id) &&
      !collapsedSupersededEntryIds.has(entry.id)
        ? ProposalLinks.inlinePaperProposalReferences(entry.message.text).map((reference) =>
            JSON.stringify([entry.message.runId, reference.cwd, reference.proposalId]),
          )
        : [],
    ),
  );
  return new Set(
    entries.flatMap((entry) =>
      entry.kind === "paper-proposal" &&
      !inline.has(
        JSON.stringify([entry.runId, entry.paperProposal.cwd, entry.paperProposal.proposalId]),
      )
        ? [entry.id]
        : [],
    ),
  );
}
