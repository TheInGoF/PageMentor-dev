// Drei-Punkte-Menü: Aktionen eines Eintrags (oder der Auswahl) gesammelt hinter ⋯
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

// align: an welcher Kante das Menü ausgerichtet ist (rechts für Zeilen am rechten Rand, links für die Auswahl-Leiste)
export function Menu({ items, label, className, align = "right" }: { items: MenuItem[]; label: string; className?: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="w-8 h-8 rounded-md grid place-items-center text-neutral-500 hover:bg-bg-hover hover:text-neutral-100"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <ul role="menu" className={cn("absolute top-full", align === "right" ? "right-0" : "left-0", " mt-1 z-40 min-w-[14rem] card py-1 shadow-card")}>
          {items.map((it) => (
            <li key={it.label}>
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                className={cn("w-full text-left px-4 py-2 text-sm hover:bg-bg-hover disabled:opacity-40", it.danger && "text-red-500")}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
