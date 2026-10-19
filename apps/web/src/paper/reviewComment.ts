import type { PaperSourceRange } from "@t3tools/contracts";
import { randomUUID } from "~/lib/utils";
import type { ReviewCommentContext } from "~/reviewCommentContext";

// The section title reaches the agent verbatim, and agents load MCP tool descriptions lazily,
// so each title carries the instruction it needs.
export const PAPER_SECTIONS = {
  comment:
    "Paper comment: quoted PDF text is the target; source lines are context. Apply clear requests directly; use paper_propose_edits for choices or previews. Put returned markdown on its own line where each option card belongs in your reply; keep explanations brief. Include complete formulas with matching boundaries in original and replacements. Check paper_status after edits",
  feedback:
    "Paper proposal feedback: apply clear requests directly; propose only for choices or previews. Put returned markdown on its own line where each option card belongs; keep explanations brief. Include complete formulas with matching boundaries. Read current source and paper_status; applied options are already saved",
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
