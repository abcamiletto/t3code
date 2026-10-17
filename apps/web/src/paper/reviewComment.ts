import type { PaperSourceRange } from "@t3tools/contracts";
import { randomUUID } from "~/lib/utils";
import type { ReviewCommentContext } from "~/reviewCommentContext";

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
