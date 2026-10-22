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
 * A proposal's status follows the file: the author may undo an applied option or restore the
 * original in their editor. An applied option edited further stays applied, without a location.
 * Only dismissal is a choice the file cannot show.
 */
export function reconcile(
  proposal: PaperProposal,
  source: string,
): { readonly status: PaperProposalStatus; readonly range?: TextRange } {
  if (proposal.status === "dismissed") return { status: "dismissed" };
  const original = locate(source, proposal.original);
  if (proposal.appliedOption !== undefined) {
    const applied = locate(source, proposalText(proposal));
    if (applied) return { status: "applied", range: applied };
    if (!original) return { status: "applied" };
  }
  return original ? { status: "pending", range: original } : { status: "stale" };
}

const lineAt = (source: string, offset: number) => lineCount(source.slice(0, offset));
const lineCount = (text: string) => text.split("\n").length;
