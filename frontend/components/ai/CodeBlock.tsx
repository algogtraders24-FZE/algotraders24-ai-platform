// components/ai/CodeBlock.tsx
// Quant Chat "Ask AI Anything" - renders one fenced code block (from
// lib/chat/parse-code-blocks.ts) as a real, readable box instead of literal
// backticks in a whitespace-pre-wrap <div>. Copy mirrors the existing
// "Copied" text-swap convention (components/license/RevealApiKeyButton.tsx);
// Download builds a real Blob and a same-tab anchor click - no network
// round-trip, the code already exists client-side in the message.
"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { extensionForLanguage } from "@/lib/chat/code-language-extensions";

interface Props {
  language: string;
  code: string;
}

export default function CodeBlock({ language, code }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail (permissions/insecure context) - the code
      // stays fully visible/selectable in the block regardless.
    }
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `strategy.${extensionForLanguage(language)}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-border bg-ink">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">{language}</span>
        <div className="flex items-center gap-3">
          <button type="button" onClick={handleCopy} className="text-[11px] font-semibold text-text-2 transition hover:text-gold">
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={handleDownload} className="flex items-center gap-1 text-[11px] font-semibold text-text-2 transition hover:text-gold">
            <Download size={11} aria-hidden="true" />
            Download
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-5 text-text">
        <code>{code}</code>
      </pre>
    </div>
  );
}
