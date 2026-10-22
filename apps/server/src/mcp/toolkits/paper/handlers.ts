import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as PaperService from "../../../paper/PaperService.ts";
import { threadWorkspaceRoot } from "../../../project/threadWorkspaceRoot.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { PaperToolkit } from "./tools.ts";

const toFailure = (error: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });

const callingWorkspace = Effect.fn("PaperTools.callingWorkspace")(function* (operation: string) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const { thread } = yield* McpInvocationContext.requireThreadScope(scope, operation);
  const cwd = yield* threadWorkspaceRoot(thread.threadId);
  if (cwd === undefined)
    return yield* new OrchestratorMcpFailure({
      code: "thread_not_found",
      message: "The calling thread's workspace was not found.",
    });
  return { cwd, threadId: thread.threadId };
});

const handlers = {
  paper_status: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const { cwd, threadId } = yield* callingWorkspace("paper_status");
      const paper = yield* PaperService.PaperService;
      const state = yield* paper.current(cwd, threadId).pipe(Effect.mapError(toFailure));
      return {
        mainFile: state.mainFile,
        build: state.build,
        proposals: state.proposals.map(
          ({ id, file, startLine, endLine, status, appliedOption, summary }) => ({
            id,
            file,
            startLine,
            endLine,
            status,
            ...(appliedOption === undefined ? {} : { appliedOption }),
            ...(summary === undefined ? {} : { summary }),
          }),
        ),
      };
    }),
  ),
  paper_propose_edits: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const workspace = yield* callingWorkspace("paper_propose_edits");
      const paper = yield* PaperService.PaperService;
      const proposal = yield* paper
        .propose({ ...workspace, ...input })
        .pipe(Effect.mapError(toFailure));
      return {
        paperProposal: { cwd: workspace.cwd, proposalId: proposal.id },
        message:
          "The author sees the options above your reply. Do not list or describe them again.",
      };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof PaperToolkit.tools>;

export const layer = McpToolAccess.toLayer(PaperToolkit, handlers);
