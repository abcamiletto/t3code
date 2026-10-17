import type { PaperPdfBox } from "@t3tools/contracts";
import { create } from "zustand";
import { randomUUID } from "~/lib/utils";

export type PaperHighlight = PaperPdfBox & { id: string };

export const EMPTY_PAPER_HIGHLIGHTS: readonly PaperHighlight[] = [];

export const usePaperHighlights = create<{
  byWorkspace: Record<string, readonly PaperHighlight[]>;
  add: (key: string, boxes: readonly PaperPdfBox[]) => void;
}>((set) => ({
  byWorkspace: {},
  add: (key, boxes) =>
    set((state) => ({
      byWorkspace: {
        ...state.byWorkspace,
        [key]: [
          ...(state.byWorkspace[key] ?? []),
          ...boxes.map((box) => ({ ...box, id: randomUUID() })),
        ],
      },
    })),
}));
