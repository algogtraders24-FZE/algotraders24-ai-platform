// components/ai/MessageBubble.tsx
// Sprint L2.4 - Three additions, all conditional on real data being
// present:
//   - a streaming cursor while this specific message is still receiving
//     real tokens (never shown once the stream has actually finished)
//   - a Sources panel when the response carried real RAG citations
//   - the full real Market Intelligence breakdown (AnalysisResult, reused
//     unmodified from Sprint L2.1) when this reply came from the
//     deterministic pipeline rather than plain chat
// Copy and Retry are real actions (clipboard write / re-send), not
// decorative buttons - see app/dashboard/assistant/page.tsx.
import type { Message } from "@/types/message";
import type { ChatSource } from "@/services/ai/assistant.service";
import type { MarketAnalysisResult } from "@/types/market-analysis-orchestration";
import SourcesPanel from "./SourcesPanel";
import AnalysisResult from "@/components/market-intelligence/AnalysisResult";

export type DisplayMessage = Message & {
  sources?: ChatSource[];
  marketAnalysis?: MarketAnalysisResult;
};

interface Props {
  message: DisplayMessage;
  isStreaming?: boolean;
  isLastAssistant?: boolean;
  onCopy: (content: string) => void;
  onRetry: () => void;
}

export default function MessageBubble({ message, isStreaming, isLastAssistant, onCopy, onRetry }: Props) {
  const isUser = message.role === "user";
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={`group flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%]">
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap ${
            isUser ? "bg-gold text-ink" : "border border-border bg-ink-2 text-text"
          }`}
        >
          {message.content}
          {isStreaming && (
            <span
              aria-hidden="true"
              className="ml-0.5 inline-block h-4 w-1.5 align-middle bg-text-3 animate-pulse"
            />
          )}
        </div>

        {!isUser && !isStreaming && message.sources && <SourcesPanel sources={message.sources} />}

        {!isUser && !isStreaming && message.marketAnalysis && (
          <div className="mt-4 rounded-2xl border border-border bg-ink p-5">
            <AnalysisResult result={message.marketAnalysis} />
          </div>
        )}

        <div className={`mt-1 flex items-center gap-3 text-[10px] text-text-3 ${isUser ? "justify-end" : "justify-start"}`}>
          <span>{time}</span>
          {!isUser && !isStreaming && (
            <button
              onClick={() => onCopy(message.content)}
              className="opacity-0 transition group-hover:opacity-100 hover:text-text-2"
            >
              Copy
            </button>
          )}
          {!isUser && !isStreaming && isLastAssistant && (
            <button onClick={onRetry} className="opacity-0 transition group-hover:opacity-100 hover:text-text-2">
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
