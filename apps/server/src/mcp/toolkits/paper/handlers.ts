import * as Effect from "effect/Effect";

import * as PaperMcpService from "../../../paper/PaperMcpService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { PaperToolkit } from "./tools.ts";

const handlers = {
  paper_status: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "paper_status");
      const paper = yield* PaperMcpService.PaperMcpService;
      return yield* paper.status(thread.threadId);
    }),
  ),
  paper_propose_edits: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(
        scope,
        "paper_propose_edits",
      );
      const paper = yield* PaperMcpService.PaperMcpService;
      return yield* paper.propose(thread.threadId, input);
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof PaperToolkit.tools>;

export const layer = McpToolAccess.toLayer(PaperToolkit, handlers);
