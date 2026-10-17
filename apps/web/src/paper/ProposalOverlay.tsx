import type { PaperProposal, ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";
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
  revealed,
}: {
  proposal: PaperProposal;
  page: number;
  scale: number;
  threadRef: ScopedThreadRef;
  cwd: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  revealed: boolean;
}) {
  const [open, setOpen] = useState(revealed);
  const boxes = proposal.boxes.filter((box) => box.page === page);
  const first = boxes[0]!;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {boxes.map((box) => (
        <div
          key={`${box.x}:${box.y}:${box.width}:${box.height}`}
          className="pointer-events-none absolute z-10 rounded-sm bg-primary/10 ring-1 ring-primary/15"
          style={{
            left: box.x * scale,
            top: box.y * scale,
            width: box.width * scale,
            height: box.height * scale,
          }}
        />
      ))}
      <div className="absolute -right-7 z-20" style={{ top: first.y * scale }}>
        <PopoverTrigger
          render={
            <Button size="micro" variant="outline" aria-label={proposal.summary ?? "Proposal"} />
          }
        >
          {proposal.options.length}
        </PopoverTrigger>
      </div>
      <PopoverPopup width="md" padding="compact" side="left" align="start">
        <ProposalCard
          proposal={proposal}
          threadRef={threadRef}
          cwd={cwd}
          composerDraftTarget={composerDraftTarget}
        />
      </PopoverPopup>
    </Popover>
  );
}
