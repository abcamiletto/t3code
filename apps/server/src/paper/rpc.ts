import { PaperRpcGroup, RpcScopeAuthorization } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { RpcInstrumentation } from "../observability/RpcInstrumentation.ts";
import * as PaperService from "./PaperService.ts";

export const layer = PaperRpcGroup.middleware(RpcScopeAuthorization)
  .middleware(RpcInstrumentation)
  .toLayer(
    Effect.gen(function* () {
      const paper = yield* PaperService.PaperService;
      return {
        "paper.subscribe": (input) => paper.subscribe(input.cwd, input.threadId),
        "paper.build": (input) => paper.build(input.cwd),
        "paper.preview": (input) => paper.preview(input),
        "paper.locateSource": (input) => paper.locateSource(input),
        "paper.resolveProposal": (input) => paper.resolve(input),
      };
    }),
  );
