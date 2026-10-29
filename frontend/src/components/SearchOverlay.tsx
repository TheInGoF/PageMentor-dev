import { useEffect, useRef, useState } from "react";
import { api, type SearchResult } from "../lib/api";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";

interface Props {
  onOpenDocument: (docId: string) => void;
}

export function SearchOverlay({ onOpenDocument }: Props) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const timer = useRef<number | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Strg+K (Mac: ⌘K) springt von überall in die Suche
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    api.search
      .status()
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    // Always cancel the pending debounce first — otherwise clearing
    // the input lets a stale timer fetch the old query and pop the
    // dropdown open under an empty search box.
    if (timer.current) window.clearTimeout(timer.current);
    if (!q.trim()) {
      setResult(null);
      setOpen(false);
      return;
    }
    timer.current = window.setTimeout(async () => {
      try {
        const r = await api.search.query(q);
        setResult(r);
        setOpen(true);
      } catch {
        // ignore transient errors
      }
    }, 200);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [q]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (container.current && !container.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (enabled === false) {
    return (
      <input
        type="search"
        disabled
        placeholder={t("search.disabled")}
        className="input opacity-50"
      />
    );
  }

  return (
    <div ref={container} className="relative flex-1">
      <input
        ref={input}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => result && setOpen(true)}
        placeholder={t("search.placeholder")}
        className="input"
      />
      {open && result && (result.documents.length + result.chapters.length > 0) && (
        <div className="absolute top-full mt-1 right-0 w-[min(36rem,90vw)] card max-h-[70vh] overflow-y-auto z-50">
          {result.documents.length > 0 && (
            <Section title={t("search.group.documents", { n: result.documents.length })}>
              {result.documents.map((hit) => (
                <button
                  key={hit.id}
                  onClick={() => {
                    setOpen(false);
                    setQ("");
                    onOpenDocument(hit.id);
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-bg-hover border-b border-border last:border-b-0"
                >
                  <div
                    className="text-sm font-medium"
                    dangerouslySetInnerHTML={{ __html: renderHighlight(hit.title) }}
                  />
                  <div className="text-xs text-neutral-500 mt-0.5">
                    {t(`type.${hit.type}`)} · {hit.page_count} {t("library.pagesShort")} ·{" "}
                    {hit.tags.map((tg) => `#${tg}`).join(" ") || t("common.none")}
                  </div>
                  {hit.snippet && (
                    <div
                      className="text-xs text-neutral-400 mt-1 line-clamp-2"
                      dangerouslySetInnerHTML={{ __html: renderHighlight(hit.snippet) }}
                    />
                  )}
                </button>
              ))}
            </Section>
          )}
          {result.chapters.length > 0 && (
            <Section title={t("search.group.chapters", { n: result.chapters.length })}>
              {result.chapters.slice(0, 15).map((hit) => (
                <button
                  key={hit.id}
                  onClick={() => {
                    setOpen(false);
                    setQ("");
                    onOpenDocument(hit.document_id);
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-bg-hover border-b border-border last:border-b-0"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-accent font-mono">
                      {String(hit.number).padStart(2, "0")}
                    </span>
                    <div
                      className="text-sm font-medium"
                      dangerouslySetInnerHTML={{ __html: renderHighlight(hit.title) }}
                    />
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5">
                    {hit.document_title}
                  </div>
                  {hit.snippet && (
                    <div
                      className="text-xs text-neutral-400 mt-1 line-clamp-2"
                      dangerouslySetInnerHTML={{ __html: renderHighlight(hit.snippet) }}
                    />
                  )}
                </button>
              ))}
            </Section>
          )}
        </div>
      )}
      {open && result && result.documents.length === 0 && result.chapters.length === 0 && q.trim() && (
        <div className="absolute top-full mt-1 left-0 right-0 card p-4 text-sm text-neutral-500 z-50">
          {t("search.empty", { q })}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="sticky top-0 bg-bg-card px-4 py-2 text-xs uppercase tracking-wide text-neutral-500 border-b border-border">
        {title}
      </div>
      {children}
    </div>
  );
}

/** Turn «highlighted» text into <mark> tags. Input is escaped. */
function renderHighlight(s: string): string {
  const esc = s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return esc
    .replaceAll("«", '<mark class="bg-accent/30 text-accent-hover rounded px-0.5">')
    .replaceAll("»", "</mark>")
    .replace(/\n/g, " ");
}

// Avoid unused import detection
void cn;
