import { useEffect } from "react";

let lockCount = 0;
let savedScrollY = 0;

/**
 * Locks page scroll while mounted (e.g. while a modal is open). Plain `overflow: hidden` on
 * <body> doesn't reliably stop touch-scrolling on iOS Safari, so this instead pins the body
 * with `position: fixed` (the standard cross-browser fix) and restores the scroll position on
 * unlock. Supports nested/stacked modals via a shared lock counter - only the outermost
 * lock/unlock actually touches the DOM.
 */
export function useScrollLock() {
  useEffect(() => {
    if (lockCount === 0) {
      savedScrollY = window.scrollY;
      document.body.style.position = "fixed";
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.left = "0";
      document.body.style.right = "0";
    }
    lockCount++;

    return () => {
      lockCount--;
      if (lockCount === 0) {
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.left = "";
        document.body.style.right = "";
        window.scrollTo(0, savedScrollY);
      }
    };
  }, []);
}
