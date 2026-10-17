import type { ComponentProps } from "react";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

export function PaperIconButton({
  label,
  ...props
}: Omit<ComponentProps<typeof Button>, "size"> & {
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-xs" aria-label={label} {...props} />}
      />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
