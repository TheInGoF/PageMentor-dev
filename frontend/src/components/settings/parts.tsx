// Einheitliche Bausteine der Einstellungen nach dem UI-Styleguide:
// drei Schriftgrößen (Titel text-base, Text text-sm, Klein text-xs), Abstände in 8er-Schritten
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

// Karte: Titel mit optionalem Status rechts, darunter der Inhalt
export function Card({ title, status, children }: { title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold flex-1">{title}</h2>
        {status && <span className="text-xs text-neutral-500">{status}</span>}
      </div>
      {children}
    </section>
  );
}

// Einstellungszeile: Bezeichnung links, Bedienelement rechts, Erklärung klein darunter
export function SettingRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-neutral-500">{hint}</div>}
      </div>
      <div className="sm:w-72 flex-none">{children}</div>
    </div>
  );
}

// Experten- und Diagnoseoptionen, ausklappbar am Ende der Seite
export function Expert({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="card p-4 group">
      <summary className="text-base font-semibold cursor-pointer select-none">{title}</summary>
      <div className="flex flex-col gap-6 pt-4">{children}</div>
    </details>
  );
}

// Hinweisbox: Info, Warnung, Fehler, immer gleich aufgebaut
export function Notice({ kind = "info", children, action }: { kind?: "info" | "warn" | "error"; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-md border p-2 px-4 text-sm flex items-center gap-4",
        kind === "info" && "border-border bg-bg-elevated",
        kind === "warn" && "border-amber-500/40 bg-amber-500/10",
        kind === "error" && "border-red-500/40 bg-red-500/10"
      )}
    >
      <span className="flex-1">{children}</span>
      {action}
    </div>
  );
}

// Kleine Zwischenüberschrift innerhalb einer Karte oder des Expertenbereichs
export function SubTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold">{children}</h3>;
}
