import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { t } from "../lib/i18n";

interface Props {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
}

/** Komma-separiertes Tag-Feld mit Autocomplete aus bekannten Labels. */
export function TagInput({ value, onChange, label, placeholder }: Props) {
  const [allTags, setAllTags] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.documents
      .tags()
      .then((rows) => setAllTags(rows.map((r) => r.label)))
      .catch(() => setAllTags([]));
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pieces = value.split(",").map((p) => p.trim());
  const lastPiece = pieces[pieces.length - 1].replace(/^#/, "").toLowerCase();
  const already = new Set(
    pieces.slice(0, -1).map((p) => p.replace(/^#/, "").trim().toLowerCase())
  );
  const matches = lastPiece
    ? allTags
        .filter((t) => t.includes(lastPiece) && !already.has(t))
        .slice(0, 8)
    : allTags.filter((t) => !already.has(t)).slice(0, 8);

  function pick(tag: string) {
    const before = pieces.slice(0, -1).join(", ");
    const next = (before ? before + ", " : "") + tag + ", ";
    onChange(next);
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(matches[cursor]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1">
      {label && <label className="text-xs font-medium text-neutral-400">{label}</label>}
      <input
        ref={inputRef}
        className="input"
        value={value}
        placeholder={placeholder ?? t("upload.tagsPlaceholder")}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setCursor(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && matches.length > 0 && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 card max-h-56 overflow-y-auto">
          {matches.map((t, i) => (
            <button
              key={t}
              type="button"
              onClick={() => pick(t)}
              onMouseEnter={() => setCursor(i)}
              className={
                "w-full text-left px-3 py-1.5 text-sm " +
                (i === cursor ? "bg-bg-hover text-accent" : "text-neutral-200")
              }
            >
              #{t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
