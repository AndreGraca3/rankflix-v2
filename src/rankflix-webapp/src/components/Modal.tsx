import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { useScrollLock } from "../hooks/useScrollLock";

interface ModalProps {
  onClose: () => void;
  overlayClassName?: string;
  modalClassName?: string;
  /** Disable closing on backdrop click (e.g. while a blocking action is in progress). */
  disableBackdropClose?: boolean;
  children: (requestClose: () => void) => ReactNode;
}

/**
 * Reusable modal wrapper that adds a "closing" class (triggered before unmount)
 * so overlays/panels can play a pop-out/fade-out animation instead of disappearing instantly.
 * Reuses the existing .media-modal-overlay/.media-modal fade+pop keyframes by default.
 */
export function Modal({
  onClose,
  overlayClassName = "media-modal-overlay",
  modalClassName = "media-modal",
  disableBackdropClose = false,
  children,
}: ModalProps) {
  const [closing, setClosing] = useState(false);

  useScrollLock();

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
  };

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!disableBackdropClose) requestClose();
  };

  // Same rule as backdrop click: Escape closes the modal unless a blocking action is in
  // progress. Listens in the capture phase so the topmost mounted modal (the last one, since
  // modals stack in DOM order) gets first refusal when several are open at once.
  useEffect(() => {
    if (disableBackdropClose) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disableBackdropClose, closing]);

  return (
    <div className={`${overlayClassName}${closing ? " closing" : ""}`} onClick={handleBackdropClick}>
      <div
        className={`${modalClassName}${closing ? " closing" : ""}`}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={() => {
          if (closing) onClose();
        }}
      >
        {children(requestClose)}
      </div>
    </div>
  );
}

