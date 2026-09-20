import { useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

interface ModalProps {
  onClose: () => void;
  overlayClassName?: string;
  modalClassName?: string;
  /** Disable closing on backdrop click (e.g. while a blocking action is in progress). */
  disableBackdropClose?: boolean;
  children: (requestClose: () => void) => ReactNode;
}

/**
 * Reusable modal wrapper built on Radix's unstyled Dialog primitive rather than the pre-styled
 * shadcn/ui Dialog pieces - shadcn's default Tailwind classes (fixed centering, its own
 * background/padding/animations) would fight the site's existing hand-styled modal skins
 * (.media-modal, .rating-modal, etc.), so this composes the raw Radix primitives directly and
 * lets those legacy CSS classes keep controlling the look. In exchange we get, for free, a
 * correct focus trap, ARIA roles, body scroll lock, and Escape/outside-click handling - all of
 * which used to be hand-rolled here.
 *
 * The overlay/modal panel are siblings under Radix's Portal (not nested, unlike the old plain-div
 * version), so centering the panel on screen is done directly on it via fixed positioning classes
 * rather than relying on the overlay's flexbox centering.
 */
export function Modal({
  onClose,
  overlayClassName = "media-modal-overlay",
  modalClassName = "media-modal",
  disableBackdropClose = false,
  children,
}: ModalProps) {
  const [open, setOpen] = useState(true);
  const [closing, setClosing] = useState(false);

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    setOpen(false);
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !disableBackdropClose) requestClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={`${overlayClassName}${closing ? " closing" : ""}`} />
        <DialogPrimitive.Content
          className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[201] ${modalClassName}${closing ? " closing" : ""}`}
          onAnimationEnd={() => {
            if (closing) onClose();
          }}
          onEscapeKeyDown={(e) => {
            if (disableBackdropClose) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (disableBackdropClose) e.preventDefault();
          }}
        >
          <DialogPrimitive.Title asChild>
            <span className="sr-only">Dialog</span>
          </DialogPrimitive.Title>
          <DialogPrimitive.Description asChild>
            <span className="sr-only">Dialog content</span>
          </DialogPrimitive.Description>
          {children(requestClose)}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}


