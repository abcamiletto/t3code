import type { ScopedThreadRef } from "@t3tools/contracts";
import { lazy, Suspense } from "react";
import type { PaperProposalTimelineRow as Row } from "./timeline";

const PaperProposalRow = lazy(() => import("./PaperProposalRow"));

export function PaperProposalTimelineRow({
  row,
  threadRef,
}: {
  row: Row;
  threadRef: ScopedThreadRef | null;
}) {
  return (
    threadRef && (
      <Suspense fallback={null}>
        <PaperProposalRow threadRef={threadRef} reference={row.paperProposal} />
      </Suspense>
    )
  );
}
