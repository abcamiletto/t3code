import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import type { PdfTextSelection } from "./PdfView";

const FORM_WIDTH = 288;

/** The comment form that opens under a PDF selection, ready for typing. */
export function SelectionComment(props: {
  readonly selection: PdfTextSelection;
  readonly text: string;
  readonly onTextChange: (text: string) => void;
  readonly onSubmit: () => Promise<string | null>;
  readonly onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!props.text.trim() || busy) return;
    setBusy(true);
    const failure = await props.onSubmit();
    setBusy(false);
    setError(failure);
  };
  const { end } = props.selection;
  return (
    <div
      className="absolute z-30 flex flex-col gap-2 rounded-lg border bg-popover p-2 shadow-lg"
      style={{ left: Math.max(8, end.x - FORM_WIDTH), top: end.y + 6, width: FORM_WIDTH }}
      // Typing and clicking in the form are not new selections in the PDF.
      onPointerUp={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <Textarea
        autoFocus
        size="sm"
        aria-label="Comment for the agent"
        placeholder="What should change here?"
        value={props.text}
        disabled={busy}
        onChange={(event) => props.onTextChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            props.onCancel();
          } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex items-center justify-end gap-1">
        <Button size="xs" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button size="xs" disabled={busy || !props.text.trim()} onClick={() => void submit()}>
          Add to message
        </Button>
      </div>
    </div>
  );
}
