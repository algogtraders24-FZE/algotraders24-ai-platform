// components/ai/ChatInput.tsx
// Sprint L2.4 - while a response is actually generating, the Send button
// becomes a real Stop button wired to the in-flight AbortController (see
// app/dashboard/assistant/page.tsx's handleStop) - not a disabled/decorative
// state.
//
// Quant Chat "Ask AI Anything" - optional file-attach affordance. `onAttachFile`
// is additive and opt-in: omitted, this component renders byte-identical to
// before (every existing caller - the dashboard Assistant page, Trading
// Copilot - is unaffected). ChatInput stays presentational/controlled: it
// never reads the file itself, only hands the raw File to the caller and
// displays whatever `attachedFileName` the caller reports back, mirroring
// the existing isGenerating/onStop controlled-prop pattern.
"use client";

import { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  isGenerating: boolean;
  onAttachFile?: (file: File) => void;
  attachedFileName?: string | null;
  onRemoveAttachment?: () => void;
}

export default function ChatInput({ onSend, onStop, isGenerating, onAttachFile, attachedFileName, onRemoveAttachment }: Props) {
  const [text, setText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const trimmed = text.trim();
    if ((!trimmed && !attachedFileName) || isGenerating) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <div className="border-t border-border p-3">
      {attachedFileName && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-2">
          <Paperclip size={12} aria-hidden="true" />
          <span className="flex-1 truncate">{attachedFileName}</span>
          <button type="button" onClick={onRemoveAttachment} aria-label="Remove attachment" className="text-text-3 hover:text-danger">
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        {onAttachFile && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.csv,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onAttachFile(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach a file"
              title="Attach a file"
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-border text-text-2 transition hover:border-gold/50 hover:text-text"
            >
              <Paperclip size={16} aria-hidden="true" />
            </button>
          </>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Ask about a market, concept, or strategy..."
          className="flex-1 resize-none rounded-xl border border-border bg-ink px-3 py-2.5 text-sm text-text outline-none focus:border-gold/50"
        />
        {isGenerating ? (
          <button
            onClick={onStop}
            className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-text transition hover:border-danger/50 hover:text-danger"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!text.trim() && !attachedFileName}
            className="rounded-xl bg-gold px-4 py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
