import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { t, useLocale } from "../lib/i18n";

export function ShortcutsOverlay() {
  useLocale();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "?" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "/" && !isTypingTarget(e.target)) {
        const input = document.querySelector<HTMLInputElement>(
          'input[type="search"]'
        );
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const global: Array<{ keys: string[]; labelKey: string }> = [
    { keys: ["?"], labelKey: "shortcuts.global.help" },
    { keys: [t("shortcuts.key.esc")], labelKey: "shortcuts.global.close" },
    { keys: ["/"], labelKey: "shortcuts.global.search" },
  ];
  const review: Array<{ keys: string[]; labelKey: string }> = [
    { keys: [t("shortcuts.key.space")], labelKey: "shortcuts.review.reveal" },
    { keys: ["1"], labelKey: "shortcuts.review.forgot" },
    { keys: ["2"], labelKey: "shortcuts.review.partial" },
    { keys: ["3"], labelKey: "shortcuts.review.known" },
  ];

  return (
    <Modal open={open} onClose={() => setOpen(false)} title={t("shortcuts.title")}>
      <div className="flex flex-col gap-5 text-sm">
        <Section title={t("shortcuts.section.global")} items={global} />
        <Section title={t("shortcuts.section.review")} items={review} />
      </div>
    </Modal>
  );
}

function Section({
  title,
  items,
}: {
  title: string;
  items: Array<{ keys: string[]; labelKey: string }>;
}) {
  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wide text-neutral-500 mb-2">
        {title}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {items.map((s) => (
          <li key={s.labelKey} className="flex items-center justify-between gap-3">
            <span className="text-neutral-200">{t(s.labelKey)}</span>
            <span className="flex gap-1">
              {s.keys.map((k) => (
                <kbd
                  key={k}
                  className="px-2 py-0.5 rounded border border-border bg-bg-elevated text-[11px] text-neutral-300 font-mono"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (t.isContentEditable) return true;
  return false;
}
