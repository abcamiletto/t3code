import { WS_METHODS } from "@t3tools/contracts";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import type { Atom } from "effect/reactivity";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

export function createPaperEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  return {
    state: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "paper:state",
      tag: WS_METHODS.paperSubscribe,
      idleTtlMs: 0,
    }),
    build: createEnvironmentRpcCommand(runtime, {
      label: "paper:build",
      tag: WS_METHODS.paperBuild,
    }),
    syncFromPdf: createEnvironmentRpcCommand(runtime, {
      label: "paper:sync",
      tag: WS_METHODS.paperSyncFromPdf,
    }),
    resolveProposal: createEnvironmentRpcCommand(runtime, {
      label: "paper:resolve",
      tag: WS_METHODS.paperResolveProposal,
    }),
  };
}
