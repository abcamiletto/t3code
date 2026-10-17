import {
  OrchestratorMcpFailure,
  PaperDiagnostic,
  PaperProposalOption,
  PaperProposalReference,
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
    "Check the calling thread's LaTeX paper build. Use after editing .tex files to confirm the paper still compiles and to read errors. Returns the main file, build status, diagnostics (errors first, at most 20), last good PDF path, and pending rewrite proposals.",
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
    'When the user leaves a "Paper comment" or asks to rephrase, rewrite, or tighten part of the paper, propose 2–4 genuinely different alternatives with this tool instead of editing the file directly. The user picks an option in the Paper panel (T3 applies it) or replies with feedback in chat. Keep original a minimal exact source span, usually a sentence or paragraph, occurring exactly once in the workspace-relative file. Each option is replacement LaTeX, with an optional short note explaining its approach.',
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
