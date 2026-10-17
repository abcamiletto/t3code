import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { useRightPanelStore } from "~/rightPanelStore";

export const usePaperReveal = create<{
  requests: Record<string, { proposalId: string; requestId: number }>;
}>(() => ({ requests: {} }));

export function revealPaperProposal(threadRef: ScopedThreadRef, proposalId: string) {
  const key = scopedThreadKey(threadRef);
  usePaperReveal.setState((state) => ({
    requests: {
      ...state.requests,
      [key]: { proposalId, requestId: (state.requests[key]?.requestId ?? 0) + 1 },
    },
  }));
}

export function openPaperPanel(threadRef: ScopedThreadRef, options?: { proposalId?: string }) {
  if (options?.proposalId) revealPaperProposal(threadRef, options.proposalId);
  useRightPanelStore.getState().open(threadRef, "paper");
}
