import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { useRightPanelStore } from "~/rightPanelStore";

export const usePaperReveal = create<{
  requests: Record<string, { proposalId: string; requestId: number }>;
}>(() => ({ requests: {} }));

export function openPaperPanel(threadRef: ScopedThreadRef, options?: { proposalId?: string }) {
  if (options?.proposalId) {
    const key = scopedThreadKey(threadRef);
    const proposalId = options.proposalId;
    usePaperReveal.setState((state) => ({
      requests: {
        ...state.requests,
        [key]: { proposalId, requestId: (state.requests[key]?.requestId ?? 0) + 1 },
      },
    }));
  }
  useRightPanelStore.getState().open(threadRef, "paper");
}
