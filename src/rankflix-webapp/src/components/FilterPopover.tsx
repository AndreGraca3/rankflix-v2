import { useState, type ReactNode } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

interface FilterPopoverProps {
  label: ReactNode;
  active: boolean;
  title?: string;
  children: (close: () => void) => ReactNode;
}

// Generic trigger-button + panel, used for the media list's genre/rating filter dropdowns
// (mirrors RankingMemberSelect's popover mechanics). Positioning/outside-click/escape are all
// handled by Radix's Popover primitive now instead of a hand-rolled portal + getBoundingClientRect
// + scroll/resize-listener dance.
export function FilterPopover({ label, active, title, children }: FilterPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={`filter-popover-trigger${active ? " active" : ""}${open ? " open" : ""}`}
          title={title}
        >
          <span className="filter-popover-trigger-label">{label}</span>
          <span className="filter-popover-chevron">▾</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content className="filter-popover-panel" side="bottom" align="start" sideOffset={6}>
          {children(() => setOpen(false))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
