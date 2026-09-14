import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface FilterPopoverProps {
  label: string;
  active: boolean;
  children: (close: () => void) => ReactNode;
}

// Generic trigger-button + portal-rendered panel, used for the media list's genre/rating
// filter dropdowns (mirrors RankingMemberSelect's popover mechanics).
export function FilterPopover({ label, active, children }: FilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest(".filter-popover-portal")
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const updatePos = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left });
    };
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open]);

  return (
    <div className="filter-popover" ref={ref}>
      <button
        type="button"
        ref={triggerRef}
        className={`filter-popover-trigger${active ? " active" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="filter-popover-trigger-label">{label}</span>
        <span className="filter-popover-chevron">▾</span>
      </button>
      {open &&
        createPortal(
          <div className="filter-popover-panel filter-popover-portal" style={{ top: pos.top, left: pos.left }}>
            {children(() => setOpen(false))}
          </div>,
          document.body
        )}
    </div>
  );
}
