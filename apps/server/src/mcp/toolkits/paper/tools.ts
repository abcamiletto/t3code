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
    "Check the calling thread's LaTeX paper against files on disk, building and waiting when needed. Returns the main file, build status, diagnostics (errors first, at most 20), last good PDF path, pending proposals, and the five most recent resolved proposals, including applied choices and dismissals even after their chat chips are deleted.",
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
    'Default to this tool for review comments whose section is "Paper comment" or "Paper proposal", and requests to rewrite paper text. Offer 2–4 genuinely different replacement LaTeX options, each with a short note. Use a minimal exact original span occurring once in the workspace-relative file. Never also edit that span directly. The user selects an option for T3 to apply. After proposal feedback, propose revised options again rather than editing directly, unless explicitly told to apply.',
  parameters: Schema.Struct({
    file: Schema.String,
    original: Schema.String.check(Schema.isMinLength(1)),
    options: Schema.Array(PaperProposalOption).check(Schema.isMinLength(2), Schema.isMaxLength(4)),
    summary: Schema.optionalKey(Schema.String),
  }),
  success: Schema.Struct({ paperProposal: PaperProposalReference, message: Schema.String }),
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
