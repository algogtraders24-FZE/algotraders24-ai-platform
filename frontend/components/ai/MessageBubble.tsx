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
//
// Sprint D2.6.10 - Trader Intelligence Workspace & Verified Answer
// Experience. A fourth, similarly conditional addition: the real,
// server-verified VerifiedAnswerResponse (D2.6.5-D2.6.9's chat-
// integrated intelligence pipeline - a different, broader-coverage
// surface than the `marketAnalysis` field above, see assistant.service
// .ts's header) renders as VerifiedAIAnswerCard when present, never a
// fabricated substitute when it's absent.
import type { Message } from "@/types/message";
import type { ChatSource } from "@/services/ai/assistant.service";
import type { MarketAnalysisResult } from "@/types/market-analysis-orchestration";
import type { VerifiedAnswerResponse } from "@/types/verified-answer-response";
import SourcesPanel from "./SourcesPanel";
import AnalysisResult from "@/components/market-intelligence/AnalysisResult";
import VerifiedAIAnswerCard from "@/components/intelligence-workspace/VerifiedAIAnswerCard";
import Disclaimer from "@/components/ui/Disclaimer";

export type DisplayMessage = Message & {
  sources?: ChatSource[];
  marketAnalysis?: MarketAnalysisResult;
  intelligence?: VerifiedAnswerResponse;
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

        {!isUser && !isStreaming && message.intelligence && (
          <div className="mt-4">
            <VerifiedAIAnswerCard result={message.intelligence} />
          </div>
        )}

        {/* Sprint D2.3 Final Audit - every other assistant reply (free-text
            chat, RAG-grounded or plain) had no disclaimer at all - only the
            deterministic market-analysis branch above did (via
            AnalysisResult's own <Disclaimer />, so it's deliberately not
            duplicated here). This was the one AI-output surface the S4
            sprint's own stated rule ("shown wherever an AI-generated...
            evidence-backed reply is presented") didn't actually reach.
            Sprint D2.6.10 - the same exclusion applies to
            VerifiedAIAnswerCard, which renders its own <Disclaimer />. */}
        {!isUser && !isStreaming && !message.marketAnalysis && !message.intelligence && <Disclaimer className="mt-2 border-t-0 pt-0" />}

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
