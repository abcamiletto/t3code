import type { PaperProposal } from "@t3tools/contracts";
import { Check, Undo2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import { chooseOption, usePaperReview, type PaperChoice } from "./review";
import type { useProposalActions } from "./useProposalActions";
import { wordDiff } from "./wordDiff";

/** The text the file holds now: the applied option's, or the original. */
export const currentChoice = (proposal: PaperProposal): PaperChoice =>
  proposal.appliedOption ?? null;

/** What a proposal shows first: the applied option, else the first alternative. */
export function useProposalChoice(proposal: PaperProposal | undefined): PaperChoice {
  const chosen = usePaperReview((state) => (proposal ? state.choices[proposal.id] : undefined));
  if (proposal === undefined) return null;
  if (chosen !== undefined && (chosen === null || chosen < proposal.options.length)) return chosen;
  return proposal.status === "applied" ? currentChoice(proposal) : 0;
}

export const choiceText = (proposal: PaperProposal, choice: PaperChoice) =>
  choice === null ? proposal.original : (proposal.options[choice]?.latex ?? proposal.original);

const optionLetter = (index: number) => String.fromCharCode(65 + index);

export const choiceLabel = (choice: PaperChoice) =>
  choice === null ? "Original" : `Option ${optionLetter(choice)}`;

export function ProposalChoices(props: {
  readonly proposal: PaperProposal;
  readonly choice: PaperChoice;
}) {
  const { proposal } = props;
  return (
    <ToggleGroup
      aria-label="Version"
      value={[String(props.choice)]}
      onValueChange={([value]) => {
        if (value !== undefined) chooseOption(proposal.id, value === "null" ? null : Number(value));
      }}
    >
      <Toggle value="null">Original</Toggle>
      {proposal.options.map((option, index) => (
        <Toggle key={option.latex} value={String(index)} aria-label={choiceLabel(index)}>
          {optionLetter(index)}
          {proposal.appliedOption === index ? <Check aria-label="Applied" /> : null}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/** The chosen text as a word diff against the original. */
export function ProposalDiff(props: {
  readonly proposal: PaperProposal;
  readonly choice: PaperChoice;
}) {
  const { proposal, choice } = props;
  const text = choiceText(proposal, choice);
  const parts =
    choice === null ? [{ kind: "same" as const, text }] : wordDiff(proposal.original, text);
  return (
    <p className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed wrap-anywhere">
      {parts.map((part, index) => (
        <span
          // Parts never reorder, so their position identifies them.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          className={cn(
            part.kind === "removed" &&
              "rounded-xs bg-destructive/10 text-destructive line-through decoration-destructive/50",
            part.kind === "added" && "rounded-xs bg-success/12 text-success-foreground",
          )}
        >
          {part.text}
        </span>
      ))}
      {choice !== null && !text.trim() ? (
        <span className="text-muted-foreground"> (removes the passage)</span>
      ) : null}
    </p>
  );
}

/** Apply, switch, undo, dismiss or restore, depending on the proposal and the shown choice. */
export function ProposalActions(props: {
  readonly proposal: PaperProposal;
  readonly choice: PaperChoice;
  readonly actions: ReturnType<typeof useProposalActions>;
}) {
  const { proposal, choice, actions } = props;
  const disabled = !actions.enabled;
  if (proposal.status === "stale")
    return (
      <Button size="xs" variant="ghost" disabled={disabled} onClick={() => void actions.dismiss()}>
        Dismiss
      </Button>
    );
  if (proposal.status === "dismissed")
    return (
      <Button size="xs" variant="outline" disabled={disabled} onClick={() => void actions.reopen()}>
        <Undo2 />
        Restore
      </Button>
    );
  const applied = proposal.status === "applied";
  return (
    <>
      {applied ? (
        <Button size="xs" variant="ghost" disabled={disabled} onClick={() => void actions.reopen()}>
          <Undo2 />
          Undo
        </Button>
      ) : (
        <Button
          size="xs"
          variant="ghost"
          disabled={disabled}
          onClick={() => void actions.dismiss()}
        >
          Dismiss
        </Button>
      )}
      {choice !== null && choice !== currentChoice(proposal) ? (
        <Button size="xs" disabled={disabled} onClick={() => void actions.apply(choice)}>
          <Check />
          Apply {optionLetter(choice)}
        </Button>
      ) : null}
    </>
  );
}

export function proposalStatusLabel(proposal: PaperProposal) {
  switch (proposal.status) {
    case "applied":
      return `Applied ${optionLetter(proposal.appliedOption!)}`;
    case "dismissed":
      return "Dismissed";
    case "stale":
      return "The passage changed in the file";
    case "pending":
      return null;
  }
}
