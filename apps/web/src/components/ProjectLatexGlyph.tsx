import { cn } from "~/lib/utils";

export function ProjectLatexGlyph({ className }: { readonly className?: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center text-foreground",
        className,
      )}
    >
      <svg viewBox="0 0 24 20" className="size-full">
        <text
          fill="currentColor"
          fontFamily="Georgia, 'Times New Roman', serif"
          fontSize="15"
          fontWeight="700"
          textAnchor="middle"
        >
          <tspan x="4.5" y="13">
            T
          </tspan>
          <tspan x="11.5" y="16">
            E
          </tspan>
          <tspan x="19" y="13">
            X
          </tspan>
        </text>
      </svg>
    </span>
  );
}
