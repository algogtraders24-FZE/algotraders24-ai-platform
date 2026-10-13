// components/ui/RichText.tsx
// A small, dependency-free renderer for the Markdown subset the AI replies use:
// **bold**, bullet and numbered lists, headings (# ... or a line that is only
// **bold**) and paragraphs. Everything is rendered as React elements (no HTML is
// ever injected), so model output can never add markup. Used for assistant
// messages and the analysis summary so the user reads a structured brief instead
// of raw asterisks.
import type { ReactNode } from "react";

const BULLET = /^\s*([-*•])\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,4}\s+(.*)$/;
const BOLD_ONLY = /^\s*\*\*([^*]+)\*\*:?\s*$/;

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-semibold text-text">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

type Block = { kind: "h"; text: string } | { kind: "p"; text: string } | { kind: "ul"; items: string[] } | { kind: "ol"; items: string[] };

export function parseRichText(text: string, keepLines = false): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) {
      blocks.push({ kind: "p", text: para.join(keepLines ? "\n" : " ") });
      para = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flush();
      continue;
    }
    const h = HEADING.exec(line) ?? BOLD_ONLY.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: "h", text: h[1].trim() });
      continue;
    }
    const b = BULLET.exec(line);
    if (b) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "ul") last.items.push(b[2]);
      else blocks.push({ kind: "ul", items: [b[2]] });
      continue;
    }
    const n = NUMBERED.exec(line);
    if (n) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "ol") last.items.push(n[2]);
      else blocks.push({ kind: "ol", items: [n[2]] });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

/** `keepLines`: single line breaks inside a paragraph are kept (for line-oriented text such as "Label: value" rows). */
export default function RichText({ text, className = "", keepLines = false }: { text: string; className?: string; keepLines?: boolean }) {
  const blocks = parseRichText(text, keepLines);
  return (
    <div className={`space-y-2 ${className}`}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h":
            return (
              <p key={i} className="pt-1 text-xs font-semibold uppercase tracking-wider text-gold">
                {b.text}
              </p>
            );
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="list-decimal space-y-1 pl-5">
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </ol>
            );
          default:
            return <p key={i} className={keepLines ? "whitespace-pre-line" : undefined}>{inline(b.text)}</p>;
        }
      })}
    </div>
  );
}
