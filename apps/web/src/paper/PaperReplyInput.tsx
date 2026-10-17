export function PaperReplyInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <textarea
      rows={1}
      aria-label="Reply"
      placeholder="Reply…"
      className="field-sizing-content min-h-lh max-h-32 w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onSubmit();
        } else if (event.key === "Escape") {
          event.stopPropagation();
          onChange("");
        }
      }}
    />
  );
}
