import { useEffect, type RefObject } from "react";

// Selectors for elements that toggle their own dropdown/popover. When one of these is
// clicked while a *different* dropdown is open, we let the click pass through (closing the
// current one and opening the new one in a single click) instead of swallowing it - this
// keeps switching between adjacent toolbar triggers feeling like one click, not two.
const SIBLING_TRIGGER_SELECTOR =
  ".filter-popover-trigger, .ranking-member-trigger, .add-member-trigger, .autocomplete input";

/**
 * Closes an open dropdown/popover on outside click, and swallows that click (prevents it
 * from also activating whatever button/link is underneath) - unless the click landed on
 * another dropdown's own trigger, which is allowed through so switching between triggers
 * still works in a single click. Also closes on Escape.
 *
 * @param open whether the dropdown/popover is currently open
 * @param onClose callback to close it
 * @param containerRefs refs to elements that are part of "this" dropdown (trigger button,
 *   portal-rendered panel, etc.) - clicks inside these are ignored entirely
 * @param extraOpenSelector optional CSS selector for portal content that isn't tracked via
 *   a ref (e.g. a list rendered through createPortal without its own ref)
 */
export function useDropdownOutsideClick(
  open: boolean,
  onClose: () => void,
  containerRefs: Array<RefObject<HTMLElement | null>>,
  extraOpenSelector?: string
) {
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const insideOwn =
        containerRefs.some((r) => r.current?.contains(target)) ||
        (extraOpenSelector ? !!target.closest(extraOpenSelector) : false);
      if (insideOwn) return;

      onClose();

      if (target.closest(SIBLING_TRIGGER_SELECTOR)) return; // allow switching triggers in one click

      e.preventDefault();
      e.stopPropagation();
    };
    // Capture phase so we intercept before the click reaches (and activates) whatever
    // element is underneath.
    document.addEventListener("click", onDocClick, true);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, containerRefs, extraOpenSelector]);
}
