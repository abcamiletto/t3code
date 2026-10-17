import type { PaperSourceRange } from "@t3tools/contracts";
import { randomUUID } from "~/lib/utils";
import type { ReviewCommentContext } from "~/reviewCommentContext";

// The section title reaches the agent verbatim, and agents load MCP tool descriptions lazily,
// so each title carries the instruction it needs.
export const PAPER_SECTIONS = {
  comment: "Paper comment: answer with paper_propose_edits (2-4 options), do not edit the file",
  feedback:
    "Paper proposal feedback: answer with revised paper_propose_edits options, do not edit the file",
  applied: "Paper edit applied by the user: no action needed",
} as const;

export function paperReviewComment(
  range: Omit<PaperSourceRange, "source">,
  sectionTitle: string,
  text: string,
  diff: string,
): ReviewCommentContext {
  return {
    id: randomUUID(),
    sectionId: `paper:${range.file}`,
    sectionTitle,
    filePath: range.file,
    startIndex: range.startLine - 1,
    endIndex: range.endLine - 1,
    rangeLabel:
      range.startLine === range.endLine
        ? `L${range.startLine}`
        : `L${range.startLine} to L${range.endLine}`,
    text: text.trim(),
    diff,
    fenceLanguage: "latex",
  };
}
