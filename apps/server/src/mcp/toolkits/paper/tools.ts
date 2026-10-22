import {
  OrchestratorMcpFailure,
  PaperBuild,
  PaperProposalOption,
  PaperProposalReference,
  PaperProposalStatus,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as PaperService from "../../../paper/PaperService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  ProjectService.ProjectService,
  PaperService.PaperService,
];

const PaperStatusTool = Tool.make("paper_status", {
  description:
    "Build this thread's LaTeX paper from the files on disk and report the result: build status, errors and warnings (errors first), the PDF path, and this thread's proposals. When the build fails before producing a PDF, `outdated` is true and the PDF does not show your latest changes. Check the errors before saying an edit renders correctly.",
  parameters: Tool.EmptyParams,
  success: Schema.Struct({
    mainFile: Schema.NullOr(Schema.String),
    build: PaperBuild,
    proposals: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        file: Schema.String,
        startLine: Schema.Number,
        endLine: Schema.Number,
        status: PaperProposalStatus,
        appliedOption: Schema.optionalKey(Schema.Number),
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
    'Offer the author 2-4 alternative rewrites of one LaTeX passage. The author compares them typeset in the paper and applies one; the file stays unchanged until then. Use it for open-ended feedback ("awkward", "make this clearer") and editorial choices. Make precise requests (delete this, use this wording, fix a typo) as direct edits instead. `original` is the exact current source, occurring once in `file`; keep math and environments whole. The proposal appears to the author where you call the tool, so keep the surrounding reply short and do not repeat the options. Applied options are written to the file: read the source again before further edits.',
  parameters: Schema.Struct({
    file: Schema.String.annotate({ description: "Workspace-relative path of the .tex file." }),
    original: Schema.String.check(Schema.isMinLength(1)),
    options: Schema.Array(PaperProposalOption)
      .check(Schema.isMinLength(2), Schema.isMaxLength(4))
      .annotate({
        description: "Each option's `latex` replaces `original`; `note` says why in a few words.",
      }),
    summary: Schema.optionalKey(
      Schema.String.annotate({
        description: "A few words naming the change, such as 'Tighter opening'.",
      }),
    ),
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
