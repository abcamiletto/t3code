import type { PaperProposalReference } from "@t3tools/contracts";
import * as Predicate from "effect/Predicate";

export function readPaperProposalReference(value: unknown): PaperProposalReference | undefined {
  if (
    !Predicate.isObject(value) ||
    typeof value.cwd !== "string" ||
    value.cwd.length > 4096 ||
    typeof value.proposalId !== "string" ||
    value.proposalId.length > 256
  )
    return undefined;
  return { cwd: value.cwd, proposalId: value.proposalId };
}
