import type { PaperProposal, ScopedThreadRef } from "@t3tools/contracts";
import { useRef } from "react";
import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import type { DraftId } from "~/composerDraftStore";
import { ProposalCard } from "./ProposalCard";

export function ProposalOverlay({
  proposal,
  page,
  scale,
  threadRef,
  cwd,
  composerDraftTarget,
  open,
  onOpenChange,
}: {
  proposal: PaperProposal;
  page: number;
  scale: number;
  threadRef: ScopedThreadRef;
  cwd: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const boxes = proposal.boxes.filter((box) => box.page === page);
  const first = boxes[0]!;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {boxes.map((box, index) => (
        <div
          ref={index === boxes.length - 1 ? anchor : undefined}
          key={`${box.x}:${box.y}:${box.width}:${box.height}`}
          className={
            open
              ? "pointer-events-none absolute z-10 rounded-sm bg-primary/20 ring-2 ring-primary/50"
              : "pointer-events-none absolute z-10 rounded-sm bg-primary/10 ring-1 ring-primary/15"
          }
          style={{
            left: box.x * scale,
            top: box.y * scale,
            width: box.width * scale,
            height: box.height * scale,
          }}
        />
      ))}
      <div className="absolute right-2 z-20" style={{ top: first.y * scale }}>
        <PopoverTrigger
          render={
            <Button
              size="micro"
              variant="outline"
              aria-label={`Review proposed change: ${proposal.summary ?? "Proposal"}`}
            />
          }
        >
          {proposal.status === "pending" ? "Review change" : "View change"}
        </PopoverTrigger>
      </div>
      <PopoverPopup
        width="xl"
        padding="compact"
        anchor={anchor}
        side="bottom"
        align="start"
        initialFocus={false}
      >
        <ProposalCard
          proposal={proposal}
          threadRef={threadRef}
          cwd={cwd}
          composerDraftTarget={composerDraftTarget}
          showLocation={false}
          onClose={() => onOpenChange(false)}
        />
      </PopoverPopup>
    </Popover>
  );
}
