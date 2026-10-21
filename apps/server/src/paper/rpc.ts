import { PaperRpcGroup, RpcScopeAuthorization, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { RpcInstrumentation } from "../observability/RpcInstrumentation.ts";
import * as PaperService from "./PaperService.ts";

export const layer = PaperRpcGroup.middleware(RpcScopeAuthorization)
  .middleware(RpcInstrumentation)
  .toLayer(
    Effect.gen(function* () {
      const paper = yield* PaperService.PaperService;
      return {
        [WS_METHODS.paperSubscribe]: ({ cwd }) => paper.subscribe(cwd),
        [WS_METHODS.paperBuild]: ({ cwd }) => paper.build(cwd),
        [WS_METHODS.paperPreview]: paper.preview,
        [WS_METHODS.paperSyncFromPdf]: paper.syncFromPdf,
        [WS_METHODS.paperResolveProposal]: paper.resolve,
      };
    }),
  );
