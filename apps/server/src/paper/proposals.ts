import type { PaperProposal, PaperProposalStatus } from "@t3tools/contracts";

export interface TextRange {
  readonly start: number;
  readonly startLine: number;
  readonly endLine: number;
}

/** Where `text` occurs in `source`, when it occurs exactly once. */
export function locate(source: string, text: string): TextRange | undefined {
  const start = source.indexOf(text);
  if (text.length === 0 || start === -1 || source.indexOf(text, start + 1) !== -1) return;
  const startLine = lineAt(source, start);
  return { start, startLine, endLine: startLine + lineCount(text) - 1 };
}

/** The text the file holds for a proposal: the applied option's, or the original. */
export function proposalText(
  proposal: Pick<PaperProposal, "original" | "options" | "appliedOption">,
) {
  return proposal.appliedOption === undefined
    ? proposal.original
    : (proposal.options[proposal.appliedOption]?.latex ?? proposal.original);
}

/**
 * A proposal's status follows the file: the author may undo an applied option in their editor,
 * and the agent may write an option itself. An applied option edited further stays applied,
 * without a location. Only dismissal is a choice the file cannot show.
 */
export function reconcile(
  proposal: PaperProposal,
  source: string,
): {
  readonly status: PaperProposalStatus;
  readonly appliedOption?: number;
  readonly range?: TextRange;
} {
  if (proposal.status === "dismissed") return { status: "dismissed" };
  const { appliedOption } = proposal;
  const applied = appliedOption === undefined ? undefined : locate(source, proposalText(proposal));
  if (applied) return { status: "applied", appliedOption: appliedOption!, range: applied };
  const options = proposal.options.map((option) => locate(source, option.latex));
  const found = options.findIndex((range) => range !== undefined);
  if (found !== -1) return { status: "applied", appliedOption: found, range: options[found]! };
  const original = locate(source, proposal.original);
  // An insertion keeps its anchor even after acceptance and subsequent editing.
  if (appliedOption !== undefined && proposalText(proposal).includes(proposal.original))
    return { status: "applied", appliedOption };
  if (original) return { status: "pending", range: original };
  return appliedOption === undefined ? { status: "stale" } : { status: "applied", appliedOption };
}

const lineAt = (source: string, offset: number) => lineCount(source.slice(0, offset));
const lineCount = (text: string) => text.split("\n").length;
