import type { PaperProposal, PaperSourceRange } from "@t3tools/contracts";

import { randomUUID } from "~/lib/utils";
import type { ReviewCommentContext } from "~/reviewCommentContext";
import { choiceLabel, choiceText } from "./ProposalParts";
import type { PaperChoice } from "./review";

// Agents read the section title with each comment, and load tool descriptions lazily, so the
// title names the tool they should answer with.
const PDF_COMMENT = "Paper comment (offer open-ended rewrites with paper_propose_edits)";
const PROPOSAL_FEEDBACK =
  "Paper proposal feedback (answer with a revised paper_propose_edits for the same passage)";

/** A comment on text selected in the PDF, with the source lines it came from. */
export function pdfComment(
  range: PaperSourceRange,
  comment: string,
  selected: string,
): ReviewCommentContext {
  return {
    ...located(range.file, range.startLine, range.endLine, PDF_COMMENT),
    text: `${comment.trim()}\n\nSelected in the PDF: “${selected.replace(/\s+/g, " ").trim()}”`,
    diff: range.source,
  };
}

/** Feedback on a proposal, with every option so the agent can revise them together. */
export function proposalFeedback(
  proposal: PaperProposal,
  choice: PaperChoice,
  comment: string,
): ReviewCommentContext {
  const versions = [null, ...proposal.options.map((_, index) => index)].map(
    (version) => `${choiceLabel(version)}:\n${choiceText(proposal, version)}`,
  );
  const applied =
    proposal.appliedOption === undefined
      ? ""
      : ` ${choiceLabel(proposal.appliedOption)} is applied in the file.`;
  return {
    ...located(proposal.file, proposal.startLine, proposal.endLine, PROPOSAL_FEEDBACK),
    text: `${comment.trim()}\n\nAbout “${proposal.summary ?? "the proposal"}”, viewing ${choiceLabel(choice)}.${applied}`,
    diff: versions.join("\n\n"),
  };
}

function located(file: string, startLine: number, endLine: number, sectionTitle: string) {
  return {
    id: randomUUID(),
    sectionId: `paper:${file}`,
    sectionTitle,
    filePath: file,
    startIndex: startLine - 1,
    endIndex: endLine - 1,
    rangeLabel: startLine === endLine ? `L${startLine}` : `L${startLine} to L${endLine}`,
    fenceLanguage: "latex",
  };
}
