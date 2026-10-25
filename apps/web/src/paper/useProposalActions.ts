import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { PaperProposal, PaperProposalAction, ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";

import { formatEnvironmentQueryError } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { focusProposal, usePaperReview } from "./review";
import { paperEnvironment } from "./state";

/** Apply, dismiss and reopen for one proposal, with the pending state and the last error. */
export function useProposalActions(
  threadRef: ScopedThreadRef,
  cwd: string,
  proposal: PaperProposal,
) {
  const resolve = useAtomCommand(paperEnvironment.resolveProposal, { reportFailure: false });
  const canWrite = useAtomValue(
    paperEnvironment.resolveProposal.permissionAtom(threadRef.environmentId),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: PaperProposalAction) => {
    setBusy(true);
    setError(null);
    const result = await resolve({
      environmentId: threadRef.environmentId,
      input: { cwd, proposalId: proposal.id, action },
    });
    setBusy(false);
    if (result._tag === "Failure") setError(formatEnvironmentQueryError(result.cause));
    else if (
      usePaperReview.getState().focused[scopedThreadKey(threadRef)]?.proposalId === proposal.id
    )
      focusProposal(threadRef, null);
  };
  return {
    enabled: canWrite && !busy,
    error,
    apply: (option: number) => run({ type: "apply", option }),
    dismiss: () => run({ type: "dismiss" }),
    reopen: () => run({ type: "reopen" }),
  };
}
