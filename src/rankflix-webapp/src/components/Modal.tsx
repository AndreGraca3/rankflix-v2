import { useState, type MouseEvent, type ReactNode } from "react";

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

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
  };

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!disableBackdropClose) requestClose();
  };

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
