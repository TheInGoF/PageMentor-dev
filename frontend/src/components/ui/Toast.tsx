import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type Variant = "info" | "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  variant: Variant;
}

interface ToastCtx {
  show: (message: string, variant?: Variant) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, variant: Variant = "info") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, message, variant }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4000);
  }, []);

  // Memoize the provider value — otherwise `{ show }` is a new
  // object on every render, every `useToast()` consumer gets a new
  // `toast` reference, and useEffects with `toast` in deps fire on
  // every toast render. Concrete symptom bug: the voice picker in
  // Audiobook snapped back to default when clicking "Generate audio".
  const ctxValue = useMemo(() => ({ show }), [show]);

  return (
    <Ctx.Provider value={ctxValue}>
      {children}
      {/* Toasts sitzen UNTERHALB des Sticky-Headers (h-14 + Search-Zeile
          ~90 px total). Vorher top-4 → Toasts überdeckten den Header,
          User musste warten bis sie wegfaden bevor er Nav-Buttons
          anklicken konnte. */}
      <div className="fixed top-24 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
        {items.map((t) => (
          <div
            key={t.id}
            className={
              "pointer-events-auto card px-4 py-3 text-sm min-w-[220px] " +
              (t.variant === "error"
                ? "border-accent text-accent"
                : t.variant === "success"
                ? "border-emerald-500/60 text-emerald-400"
                : "text-neutral-100")
            }
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
