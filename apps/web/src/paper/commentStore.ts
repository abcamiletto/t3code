import type { PaperPdfBox } from "@t3tools/contracts";
import { create } from "zustand";
import { randomUUID } from "~/lib/utils";

export type PaperHighlight = PaperPdfBox & { id: string; commentId: string };

export const EMPTY_PAPER_HIGHLIGHTS: readonly PaperHighlight[] = [];

export const usePaperHighlights = create<{
  byWorkspace: Record<string, readonly PaperHighlight[]>;
  add: (key: string, commentId: string, boxes: readonly PaperPdfBox[]) => void;
  clear: (key: string) => void;
}>((set) => ({
  byWorkspace: {},
  add: (key, commentId, boxes) =>
    set((state) => ({
      byWorkspace: {
        ...state.byWorkspace,
        [key]: [
          ...(state.byWorkspace[key] ?? []),
          ...boxes.map((box) => ({ ...box, id: randomUUID(), commentId })),
        ],
      },
    })),
  clear: (key) =>
    set((state) => {
      const { [key]: _, ...byWorkspace } = state.byWorkspace;
      return { byWorkspace };
    }),
}));
