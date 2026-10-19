import type { PaperProposalReference, ScopedThreadRef } from "@t3tools/contracts";
import { lazy, Suspense } from "react";

const PaperProposalRow = lazy(() => import("./PaperProposalRow"));

export function PaperProposal({
  reference,
  threadRef,
}: {
  reference: PaperProposalReference;
  threadRef: ScopedThreadRef | null;
}) {
  return (
    threadRef && (
      <Suspense fallback={null}>
        <PaperProposalRow threadRef={threadRef} reference={reference} />
      </Suspense>
    )
  );
}
