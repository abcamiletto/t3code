import { MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { Textarea } from "~/components/ui/textarea";
import { Button } from "~/components/ui/button";
import { PaperIconButton } from "./PaperIconButton";
import type { PaperSelection } from "./selection";

export function SelectionComment({
  selection,
  onSubmit,
  onCancel,
}: {
  selection: PaperSelection;
  onSubmit: (selection: PaperSelection, text: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const success = await onSubmit(selection, text);
    setBusy(false);
    if (success) onCancel();
  };
  return (
    <div
      className="absolute z-30"
      style={{ left: editing ? selection.formLeft : selection.left, top: selection.top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {editing ? (
        <div className="flex w-64 max-w-[calc(100vw-4rem)] flex-col gap-1 rounded-md border border-border bg-popover p-2 shadow-md">
          <Textarea
            autoFocus
            size="sm"
            aria-label="Comment for the agent"
            placeholder="Comment for the agent…"
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="flex justify-end">
            <Button
              size="xs"
              variant="ghost"
              disabled={busy || !text.trim()}
              onClick={() => void submit()}
            >
              Comment
            </Button>
          </div>
        </div>
      ) : (
        <PaperIconButton
          label="Comment"
          variant="outline"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setEditing(true)}
        >
          <MessageSquarePlus />
        </PaperIconButton>
      )}
    </div>
  );
}
