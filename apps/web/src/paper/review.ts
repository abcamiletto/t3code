import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { PaperPdfBox, PaperPreview, ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

import { useRightPanelStore } from "~/rightPanelStore";

/** `null` is the original text; a number is an option. */
export type PaperChoice = number | null;

interface PaperReviewState {
  /** The proposal the Paper panel reviews, per thread. */
  readonly focused: Readonly<
    Record<string, { readonly proposalId: string; readonly request: number }>
  >;
  /** The choice on screen for each proposal, shared by its chat card and the Paper panel. */
  readonly choices: Readonly<Record<string, PaperChoice>>;
  /** Chat cards unmount when they scroll away; they reopen as they were left. */
  readonly expanded: Readonly<Record<string, boolean>>;
  /** Chat cards that show their choices typeset instead of the source diff. */
  readonly typeset: Readonly<Record<string, boolean>>;
  /**
   * The last typeset version of each proposal's choices, shown while a rebuild typesets it again
   * instead of falling back to the original text.
   */
  readonly previews: Readonly<Record<string, Extract<PaperPreview, { status: "ready" }>>>;
  /** Where each PDF comment in a composer draft was made, for the build it was made on. */
  readonly comments: Readonly<Record<string, CommentMark>>;
}

interface CommentMark {
  readonly revision: number;
  readonly boxes: readonly PaperPdfBox[];
}

export const usePaperReview = create<PaperReviewState>(() => ({
  focused: {},
  choices: {},
  expanded: {},
  typeset: {},
  previews: {},
  comments: {},
}));

export function focusProposal(threadRef: ScopedThreadRef, proposalId: string | null) {
  const key = scopedThreadKey(threadRef);
  usePaperReview.setState((state) => {
    const { [key]: previous, ...rest } = state.focused;
    return {
      focused:
        proposalId === null
          ? rest
          : { ...rest, [key]: { proposalId, request: (previous?.request ?? 0) + 1 } },
    };
  });
}

export function setExpanded(proposalId: string, expanded: boolean) {
  usePaperReview.setState((state) => ({ expanded: { ...state.expanded, [proposalId]: expanded } }));
}

export function showTypeset(proposalId: string, typeset: boolean) {
  usePaperReview.setState((state) => ({ typeset: { ...state.typeset, [proposalId]: typeset } }));
}

export const previewKey = (proposalId: string, choice: PaperChoice) => `${proposalId}:${choice}`;

export function keepPreview(key: string, preview: Extract<PaperPreview, { status: "ready" }>) {
  usePaperReview.setState((state) =>
    // One file per proposal, choice and build, so the path identifies the preview.
    state.previews[key]?.pdf === preview.pdf
      ? state
      : { previews: { ...state.previews, [key]: preview } },
  );
}

export function markComment(commentId: string, mark: CommentMark) {
  usePaperReview.setState((state) => ({ comments: { ...state.comments, [commentId]: mark } }));
}

export function chooseOption(proposalId: string, choice: PaperChoice) {
  usePaperReview.setState((state) => ({ choices: { ...state.choices, [proposalId]: choice } }));
}

/** Opens the Paper panel, optionally reviewing one proposal. */
export function openPaper(threadRef: ScopedThreadRef, proposalId?: string) {
  focusProposal(threadRef, proposalId ?? null);
  useRightPanelStore.getState().open(threadRef, "paper");
}
