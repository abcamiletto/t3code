import {
  OrchestratorMcpFailure,
  PaperDiagnostic,
  PaperProposalOption,
  PaperProposalReference,
  PaperProposalStatus,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as PaperMcpService from "../../../paper/PaperMcpService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  PaperMcpService.PaperMcpService,
];

const PaperStatusTool = Tool.make("paper_status", {
  description:
    "Check the calling thread's LaTeX paper against files on disk, building and waiting when needed. Returns the main file, build status, diagnostics (errors first, at most 20), last good PDF path, pending proposals, and the five most recent resolved proposals. A failed build may retain an older PDF: do not claim the latest changes are visible. Font substitutions are errors because requested styles may be lost. Check diagnostics before claiming a formatting change rendered successfully.",
  parameters: Tool.EmptyParams,
  success: Schema.Struct({
    mainFile: Schema.NullOr(Schema.String),
    buildStatus: Schema.Literals(["idle", "building", "succeeded", "failed"]),
    diagnostics: Schema.Array(PaperDiagnostic),
    pdfPath: Schema.NullOr(Schema.String),
    proposals: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        file: Schema.String,
        startLine: Schema.Number,
        endLine: Schema.Number,
        summary: Schema.optionalKey(Schema.String),
      }),
    ),
    resolvedProposals: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        file: Schema.String,
        summary: Schema.optionalKey(Schema.String),
        status: PaperProposalStatus,
        appliedOptionIndex: Schema.optionalKey(Schema.Number),
      }),
    ),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Check paper build")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const PaperProposeEditsTool = Tool.make("paper_propose_edits", {
  description:
    "Show LaTeX proposals as interactive chat cards. Make closely specified edits directly: delete the marked passage, replace a term, or follow wording the user sketches; minor polishing is fine. For generic feedback ('LLM slop', 'awkward', 'make this clearer') or substantial editorial choices, propose options and wait for Apply. When asking for approval, always offer 2–4 distinct alternatives. Put returned markdown in its own paragraph where each card belongs. Keep prose and notes brief; do not repeat the card. Use the smallest self-contained exact original occurring once in the workspace-relative file. Preserve balanced braces and complete formulas with both delimiters or matching begin/end tags in original and replacements. Leave the original unchanged until Apply. Applied options are already saved; read current source and check paper_status after edits.",
  parameters: Schema.Struct({
    file: Schema.String,
    original: Schema.String.check(Schema.isMinLength(1)),
    options: Schema.Array(PaperProposalOption).check(Schema.isMinLength(2), Schema.isMaxLength(4)),
    summary: Schema.optionalKey(Schema.String),
  }),
  success: Schema.Struct({
    paperProposal: PaperProposalReference,
    markdown: Schema.String,
    message: Schema.String,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Propose paper rewrites")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const PaperToolkit = Toolkit.make(PaperStatusTool, PaperProposeEditsTool);
