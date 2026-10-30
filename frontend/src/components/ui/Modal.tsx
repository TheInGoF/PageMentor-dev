import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
}

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Schließt nur über × bzw. die Knöpfe im Fuß, nicht per Hintergrund oder Escape (docs/STYLEGUIDE.md)
export function Modal({ open, onClose, title, children, footer, size = "lg" }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus management: move focus into the dialog on open (so keyboard
  // users don't keep operating hidden background controls), keep Tab
  // cycling inside it, and restore focus to the trigger on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog) {
      const first = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? dialog).focus();
    }
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", trap);
    return () => {
      window.removeEventListener("keydown", trap);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  // Direkt unter <body>: in Kopfzeilen mit Unschärfe (backdrop-blur) würde fixed sonst am Header kleben
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`card w-full ${SIZE_CLASS[size]} flex flex-col max-h-[90vh] outline-none`}
      >
        {title && (
          <header className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-base font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-neutral-500 hover:text-accent transition-colors text-xl leading-none"
            >
              ×
            </button>
          </header>
        )}
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
}
