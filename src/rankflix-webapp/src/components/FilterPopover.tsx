import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface FilterPopoverProps {
  label: string;
  active: boolean;
  title?: string;
  children: (close: () => void) => ReactNode;
}

// Generic trigger-button + portal-rendered panel, used for the media list's genre/rating
// filter dropdowns (mirrors RankingMemberSelect's popover mechanics).
export function FilterPopover({ label, active, title, children }: FilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
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
    const margin = 8;
    const updatePos = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      // Clamp the panel's left edge so it can't spill past the right (or left) edge
      // of the viewport - important on mobile where the trigger can sit close to the
      // screen edge (e.g. the Filters icon in the consolidated toolbar).
      const panelWidth = panelRef.current?.offsetWidth ?? 220;
      const maxLeft = window.innerWidth - panelWidth - margin;
      const left = Math.max(margin, Math.min(rect.left, maxLeft));
      setPos({ top: rect.bottom + 6, left });
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
        title={title}
      >
        <span className="filter-popover-trigger-label">{label}</span>
        <span className="filter-popover-chevron">▾</span>
      </button>
      {open &&
        createPortal(
          <div
            className="filter-popover-panel filter-popover-portal"
            ref={panelRef}
            style={{ top: pos.top, left: pos.left }}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body
        )}
    </div>
  );
}
