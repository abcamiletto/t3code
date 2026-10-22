import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createPaperEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  return {
    state: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "paper:state",
      tag: WS_METHODS.paperSubscribe,
    }),
    build: createEnvironmentRpcCommand(runtime, {
      label: "paper:build",
      tag: WS_METHODS.paperBuild,
    }),
    // The input carries the build revision, so a cached preview never outlives its document.
    preview: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "paper:preview",
      tag: WS_METHODS.paperPreview,
      staleTimeMs: Infinity,
      idleTtlMs: 10 * 60_000,
    }),
    // Typeset once per proposal; the server keeps the result with the proposal.
    typesetProposal: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "paper:typeset-proposal",
      tag: WS_METHODS.paperTypesetProposal,
      staleTimeMs: Infinity,
      idleTtlMs: 10 * 60_000,
    }),
    locateSource: createEnvironmentRpcCommand(runtime, {
      label: "paper:locate-source",
      tag: WS_METHODS.paperLocateSource,
    }),
    resolveProposal: createEnvironmentRpcCommand(runtime, {
      label: "paper:resolve-proposal",
      tag: WS_METHODS.paperResolveProposal,
    }),
  };
}
