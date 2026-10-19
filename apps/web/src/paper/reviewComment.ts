import type { PaperSourceRange } from "@t3tools/contracts";
import { randomUUID } from "~/lib/utils";
import type { ReviewCommentContext } from "~/reviewCommentContext";

// The section title reaches the agent verbatim, and agents load MCP tool descriptions lazily,
// so each title carries the instruction it needs.
const REVIEW_RULES =
  "Edit directly only for user-specified exact replacements, explicit deletions, or mechanical fixes. Choosing wording, restructuring, or interpreting feedback needs paper_propose_edits and user Apply; one option is enough. Put returned markdown in its own paragraph. Keep prose brief, preserve complete math boundaries, and check paper_status after edits";

export const PAPER_SECTIONS = {
  comment: `Paper comment: quoted PDF text is the target; source lines are context. ${REVIEW_RULES}`,
  feedback: `Paper proposal feedback: applied options are already saved. Read current source. ${REVIEW_RULES}`,
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
