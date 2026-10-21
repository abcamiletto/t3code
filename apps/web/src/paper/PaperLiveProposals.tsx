import type { RunId, ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useEffect, useRef } from "react";
import { observeProactivePanelUserChoice } from "~/components/ChatView.logic";
import { useRightPanelStore } from "~/rightPanelStore";
import { useEnvironmentQuery } from "~/state/query";
import { newLivePaperProposal } from "./liveProposals";
import { revealPaperProposal } from "./openPaperPanel";
import { paperEnvironment } from "./state";

export function PaperLiveProposals({
  threadRef,
  cwd,
  runningTurnId,
  enabled,
}: {
  threadRef: ScopedThreadRef;
  cwd: string;
  runningTurnId: RunId | null;
  enabled: boolean;
}) {
  const query = useEnvironmentQuery(
    paperEnvironment.state({ environmentId: threadRef.environmentId, input: { cwd } }),
  );
  const previousIds = useRef<Set<string> | undefined>(undefined);
  const observation = useRef<ReturnType<typeof observeProactivePanelUserChoice> | null>(null);
  useEffect(() => {
    const panels = useRightPanelStore.getState();
    const choice = observeProactivePanelUserChoice(observation.current, {
      threadKey: scopedThreadKey(threadRef),
      runningTurnId,
      userActionRevision: panels.getUserActionRevision(threadRef),
    });
    observation.current = choice;
    if (!query.data || !query.isSuccess) return;
    const proposal = newLivePaperProposal(
      previousIds.current,
      query.data.proposals,
      threadRef.threadId,
    );
    previousIds.current = new Set(query.data.proposals.map((entry) => entry.id));
    if (
      enabled &&
      proposal &&
      panels.openProactive(
        threadRef,
        { id: "paper", kind: "paper" },
        choice.userActionRevision,
        true,
      )
    ) {
      revealPaperProposal(threadRef, proposal.id);
    }
  }, [threadRef, runningTurnId, enabled, query.data, query.isSuccess]);
  return null;
}
