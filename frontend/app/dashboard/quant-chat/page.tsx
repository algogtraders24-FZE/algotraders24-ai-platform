"use client";

// app/dashboard/quant-chat/page.tsx
// QP-2 - Conversational Strategy Builder's dedicated route. Reuses the
// existing components/ai/* chat shell (ChatWindow/ChatInput/
// ThinkingIndicator/PromptSuggestions) - the same additive-prop
// extensions ChatWindow/PromptSuggestions/MessageBubble gained for this
// sprint keep every existing K-series caller unaffected. Deliberately
// does NOT reuse ConversationSidebar: that component's rename/pin/
// archive/delete affordances assume a persisted, multi-conversation
// store (StoredConversation), which QP-2's locked in-memory-only-for-v1
// decision doesn't have - a single active conversation, lost on refresh,
// exactly as that decision states. Not added to dashboard nav config -
// that is a separate discoverability decision outside this sprint's
// locked scope.
//
// Two turn modes, an explicit user choice (a toggle, never an inferred
// classification) - QP-2's own locked resolution for "how does a raw
// message become MODIFY vs EXPLAIN without a guessing LLM call":
//   - Modify: sends the accumulated intent through the EXISTING
//     compileNaturalLanguageStrategy() pipeline via the new compile-only
//     /strategy-builder route (never /ai-runs, which would auto-backtest).
//   - Explain: a purely client-side, deterministic call to
//     explainStrategySpec() over the current compiledSpec - zero network,
//     zero LLM, matching the locked "no LLM call merely to paraphrase
//     structured data we already possess" decision.
import { useState } from "react";
import ChatWindow from "@/components/ai/ChatWindow";
import ChatInput from "@/components/ai/ChatInput";
import PromptSuggestions from "@/components/ai/PromptSuggestions";
import type { DisplayMessage } from "@/components/ai/MessageBubble";
import { quantChatPromptSuggestions } from "@/data/quant-chat-prompts";
import { applyStrategyBuilderModification } from "@/lib/algo-test/store";
import { explainStrategySpec } from "@/lib/ai/strategy-compiler/strategy-explainer";
import { EMPTY_QUANT_CHAT_STATE, type QuantChatConversationState } from "@/types/quant-chat";

function newId(): string {
  return `qc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function QuantChatPage() {
  const [conversationState, setConversationState] = useState<QuantChatConversationState>(EMPTY_QUANT_CHAT_STATE);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [chatMode, setChatMode] = useState<"modify" | "explain">("modify");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pushMessage(msg: DisplayMessage) {
    setMessages((prev) => [...prev, msg]);
  }

  async function handleSend(text: string) {
    setError(null);
    const now = new Date().toISOString();
    pushMessage({ id: newId(), role: "user", content: text, createdAt: now });

    if (chatMode === "explain") {
      const spec = conversationState.lastCompileResult?.compiledSpec;
      pushMessage({
        id: newId(),
        role: "assistant",
        content: spec ? explainStrategySpec(spec) : "There's no successfully compiled strategy yet to explain - switch to Modify and describe a strategy first.",
        createdAt: new Date().toISOString(),
      });
      return;
    }

    setThinking(true);
    try {
      const result = await applyStrategyBuilderModification(text, conversationState);
      setConversationState(result.state);
      const explanation = result.run.compiledSpec ? explainStrategySpec(result.run.compiledSpec) : undefined;
      pushMessage({
        id: newId(),
        role: "assistant",
        content: result.run.compiledSpec
          ? `Compiled successfully (reached ${result.run.reachedStage}).`
          : `Could not compile (reached ${result.run.reachedStage}).`,
        createdAt: new Date().toISOString(),
        strategyState: { compileResult: result.run, explanation },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong compiling this strategy.");
    } finally {
      setThinking(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-ink text-text">
      <header className="border-b border-border px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">Algo Testing Pro</p>
        <h1 className="mt-0.5 text-lg font-bold">Quant Chat</h1>
        <p className="text-xs text-text-3">Describe a strategy in plain language - session only, not saved across a refresh.</p>
      </header>

      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <button
          onClick={() => setChatMode("modify")}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${chatMode === "modify" ? "bg-gold text-ink" : "border border-border text-text-2 hover:text-text"}`}
        >
          Modify strategy
        </button>
        <button
          onClick={() => setChatMode("explain")}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${chatMode === "explain" ? "bg-gold text-ink" : "border border-border text-text-2 hover:text-text"}`}
        >
          Ask a question
        </button>
      </div>

      <ChatWindow
        messages={messages}
        thinking={thinking}
        error={error}
        onCopy={(content) => navigator.clipboard?.writeText(content)}
        onRetry={() => {}}
        emptyState={{
          title: "Describe your strategy",
          body: "e.g. “Buy XAUUSD on the 1H when EMA(9) crosses above EMA(21), with a 2% equity risk stop.”",
        }}
      />

      <div className="px-4 py-2">
        <PromptSuggestions onPick={handleSend} suggestions={quantChatPromptSuggestions} />
      </div>

      <ChatInput onSend={handleSend} onStop={() => {}} isGenerating={thinking} />
    </div>
  );
}
