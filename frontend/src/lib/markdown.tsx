/**
 * Lightweight Markdown renderer for LLM-generated text.
 *
 * Why hand-rolled instead of `marked` + `dompurify`: those add ~30 kB
 * gzip and we only need a handful of features. The renderer covers
 * what our LLM prompts (Tutor, Summaries) actually emit:
 *
 *   - # / ## / ### headings
 *   - - / * unordered list bullets
 *   - 1. 2. ordered list items
 *   - **bold** and *italic* inline
 *   - `inline code`
 *   - blank-line-separated paragraphs
 *
 * Out of scope: tables, blockquotes, links, code fences, images. If we
 * ever need those, swap in `react-markdown`.
 */

import type { ReactNode } from "react";

/** Parses inline markdown (bold, italic, code) inside a single line of
 *  text and returns a list of React nodes. The regex walks left to
 *  right, greedily matching the next inline marker; everything in
 *  between stays plain text. */
function renderInline(text: string): ReactNode[] {
  // Order matters: longer/more-specific markers first.
  // `**bold**`, `__bold__`, `*italic*`, `_italic_`, `` `code` ``
  const re = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  const out: ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) {
      out.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("__") && token.endsWith("__")) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      out.push(
        <code
          key={key++}
          className="px-1 py-0.5 rounded bg-neutral-800 text-neutral-100 text-[0.85em]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("_") && token.endsWith("_")) {
      out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    lastIdx = match.index + token.length;
  }
  if (lastIdx < text.length) {
    out.push(text.slice(lastIdx));
  }
  return out;
}

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "p"; text: string };

/** Splits the raw text into block-level chunks. Bullet runs collapse
 *  into one `ul` block; numbered runs into one `ol`. Blank lines flush
 *  the current paragraph. */
function parseBlocks(raw: string): Block[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let pBuf: string[] = [];
  let ulBuf: string[] = [];
  let olBuf: string[] = [];

  const flushP = () => {
    if (pBuf.length > 0) {
      blocks.push({ kind: "p", text: pBuf.join(" ").trim() });
      pBuf = [];
    }
  };
  const flushUl = () => {
    if (ulBuf.length > 0) {
      blocks.push({ kind: "ul", items: ulBuf });
      ulBuf = [];
    }
  };
  const flushOl = () => {
    if (olBuf.length > 0) {
      blocks.push({ kind: "ol", items: olBuf });
      olBuf = [];
    }
  };
  const flushAll = () => {
    flushP();
    flushUl();
    flushOl();
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushAll();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2],
      });
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushP();
      flushOl();
      ulBuf.push(bullet[1]);
      continue;
    }
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flushP();
      flushUl();
      olBuf.push(numbered[1]);
      continue;
    }
    flushUl();
    flushOl();
    pBuf.push(line);
  }
  flushAll();
  return blocks;
}

/** Renders a markdown-ish string as React nodes. Empty input → empty
 *  fragment. Safe to call inline in a JSX expression. */
export function renderMarkdown(text: string): ReactNode {
  if (!text || !text.trim()) return null;
  const blocks = parseBlocks(text);
  return blocks.map((block, i) => {
    switch (block.kind) {
      case "heading": {
        const sizeCls =
          block.level === 1
            ? "text-base font-semibold mt-2 mb-1"
            : block.level === 2
              ? "text-sm font-semibold mt-2 mb-1"
              : "text-sm font-semibold text-neutral-300 mt-1 mb-1";
        return (
          <div key={i} className={sizeCls}>
            {renderInline(block.text)}
          </div>
        );
      }
      case "ul":
        return (
          <ul
            key={i}
            className="list-disc pl-5 space-y-1 my-1 text-sm text-neutral-200"
          >
            {block.items.map((item, j) => (
              <li key={j}>{renderInline(item)}</li>
            ))}
          </ul>
        );
      case "ol":
        return (
          <ol
            key={i}
            className="list-decimal pl-5 space-y-1 my-1 text-sm text-neutral-200"
          >
            {block.items.map((item, j) => (
              <li key={j}>{renderInline(item)}</li>
            ))}
          </ol>
        );
      case "p":
        return (
          <p
            key={i}
            className="text-sm text-neutral-200 leading-relaxed my-1"
          >
            {renderInline(block.text)}
          </p>
        );
    }
  });
}
