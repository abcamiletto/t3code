import type { PaperState, ScopedThreadRef } from "@t3tools/contracts";
import {
  Check,
  CircleDashed,
  CircleX,
  ListChecks,
  LoaderCircle,
  Minus,
  Plus,
  RotateCw,
} from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Button } from "~/components/ui/button";
import { PaperIconButton } from "./PaperIconButton";
import { PaperProposalNavigation } from "./PaperProposalNavigation";

export function PaperToolbar({
  state,
  threadRef,
  page,
  pages,
  zoom,
  onZoom,
  onBuild,
  canBuild,
  busy,
  diagnosticsOpen,
  onDiagnostics,
}: {
  state: PaperState;
  threadRef: ScopedThreadRef;
  page: number;
  pages: number;
  zoom: number;
  onZoom: (zoom: number) => void;
  onBuild: () => void;
  canBuild: boolean;
  busy: boolean;
  diagnosticsOpen: boolean;
  onDiagnostics: () => void;
}) {
  const building = state.build.status === "building";
  const errors = state.build.diagnostics.filter((entry) => entry.severity === "error").length;
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2 text-xs">
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {state.mainFile?.split("/").at(-1) ?? "Paper"}
      </span>
      <PaperProposalNavigation state={state} threadRef={threadRef} />
      <Tooltip>
        <TooltipTrigger render={<span role="img" aria-label={state.build.status} />}>
          {building ? (
            <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
          ) : state.build.status === "succeeded" ? (
            <Check className="size-3.5 text-success-foreground" />
          ) : state.build.status === "failed" ? (
            <CircleX className="size-3.5 text-destructive" />
          ) : (
            <CircleDashed className="size-3.5 text-muted-foreground" />
          )}
        </TooltipTrigger>
        <TooltipPopup>{state.build.status}</TooltipPopup>
      </Tooltip>
      {state.build.diagnostics.length > 0 && (
        <Button
          size="micro"
          variant="ghost"
          aria-label="Diagnostics"
          aria-expanded={diagnosticsOpen}
          onClick={onDiagnostics}
        >
          <ListChecks />
          {errors}
        </Button>
      )}
      <span className="mx-1 shrink-0 tabular-nums text-muted-foreground">
        {page} / {pages}
      </span>
      <PaperIconButton
        label="Zoom out"
        disabled={zoom <= 0.5}
        onClick={() => onZoom(Math.max(0.5, zoom - 0.25))}
      >
        <Minus />
      </PaperIconButton>
      <PaperIconButton
        label="Zoom in"
        disabled={zoom >= 3}
        onClick={() => onZoom(Math.min(3, zoom + 0.25))}
      >
        <Plus />
      </PaperIconButton>
      <PaperIconButton label="Rebuild" disabled={!canBuild || busy || building} onClick={onBuild}>
        <RotateCw />
      </PaperIconButton>
    </div>
  );
}
