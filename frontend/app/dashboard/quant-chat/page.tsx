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
//
// QP-3 - a persistent "current strategy" chart preview, separate from the
// per-turn StrategyStateCard already shown in each assistant message
// (that stays as-is, unchanged). `preview` only ever advances on a
// SUCCESSFUL compile - a failed MODIFY turn leaves it exactly as it was
// (the underlying compiledSpec genuinely didn't change either, see
// quant-strategy-builder.service.ts's own "only advance currentIntent on
// success" rule), so the panel keeps showing an accurate preview of
// whatever the current strategy actually is, never a preview mislabeled
// as belonging to a turn that failed.
//
// QP-4 - "Run Backtest". Locked decision: recompile-on-run, reusing the
// EXISTING, unmodified compileAndRunAiStrategy() client wrapper (already
// in lib/algo-test/store.ts, calling the already-live /api/private/
// algo-test/ai-runs route - no new backend route needed for this sprint,
// that endpoint already IS "a thin adapter around the canonical service").
// The execution input is always `conversationState.currentIntent` at the
// moment the button is clicked - never a stale compiledSpec - so a
// backtest genuinely reflects whatever the user has modified the strategy
// to since, even across several turns. Available any time a successful
// compile exists, not only immediately after one. In-memory only
// (`backtestResult`) - no persistence beyond what compileAndRunAiStrategy
// already writes to AlgoTestRun itself.
import { useState } from "react";
import ChatWindow from "@/components/ai/ChatWindow";
import ChatInput from "@/components/ai/ChatInput";
import PromptSuggestions from "@/components/ai/PromptSuggestions";
import type { DisplayMessage } from "@/components/ai/MessageBubble";
import { quantChatPromptSuggestions } from "@/data/quant-chat-prompts";
import { applyStrategyBuilderModification, compileAndRunAiStrategy, type StrategyBuilderModificationResult } from "@/lib/algo-test/store";
import { explainStrategySpec } from "@/lib/ai/strategy-compiler/strategy-explainer";
import StrategyChartPreview from "@/components/quant-chat/StrategyChartPreview";
import BacktestResultCard from "@/components/quant-chat/BacktestResultCard";
import { buildQuantChatBacktestRequest } from "@/lib/algo-test/quant-chat-backtest-defaults";
import { EMPTY_QUANT_CHAT_STATE, type QuantChatConversationState } from "@/types/quant-chat";
import type { AlgoTestRunView } from "@/types/algo-test";

type PreviewState = StrategyBuilderModificationResult["preview"];

function newId(): string {
  return `qc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function QuantChatPage() {
  const [conversationState, setConversationState] = useState<QuantChatConversationState>(EMPTY_QUANT_CHAT_STATE);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [chatMode, setChatMode] = useState<"modify" | "explain">("modify");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>(undefined);
  const [backtestResult, setBacktestResult] = useState<AlgoTestRunView | undefined>(undefined);
  const [backtestRunning, setBacktestRunning] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);

  function pushMessage(msg: DisplayMessage) {
    setMessages((prev) => [...prev, msg]);
  }

  async function handleRunBacktest() {
    if (backtestRunning) return; // prevent duplicate submissions
    setBacktestRunning(true);
    setBacktestError(null);
    try {
      const request = buildQuantChatBacktestRequest(conversationState.currentIntent);
      const run = await compileAndRunAiStrategy(request);
      setBacktestResult(run);
    } catch (err) {
      setBacktestError(err instanceof Error ? err.message : "Something went wrong running this backtest.");
    } finally {
      setBacktestRunning(false);
    }
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
      // Only advance on a real new preview - a failed compile (or a
      // successful compile whose best-effort chart data genuinely
      // couldn't be built) leaves whatever was already showing untouched,
      // never blanked or replaced with something stale-but-mislabeled.
      if (result.preview) setPreview(result.preview);
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
        <button
          onClick={handleRunBacktest}
          disabled={!conversationState.lastCompileResult?.compiledSpec || backtestRunning}
          title={!conversationState.lastCompileResult?.compiledSpec ? "Compile a strategy successfully first" : undefined}
          className="ml-auto rounded-lg border border-gold/40 px-3 py-1.5 text-xs font-medium text-gold-strong hover:text-gold disabled:cursor-not-allowed disabled:border-border disabled:text-text-3 disabled:hover:text-text-3"
        >
          {backtestRunning ? "Running backtest…" : "Run Backtest"}
        </button>
      </div>

      {preview && (
        <div className="border-b border-border px-4 py-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-text-3">Current strategy preview</p>
          {/* QP-3 implementation review - the label alone didn't disambiguate a failed MODIFY turn from "the chart just updated to match it." A failed compile never touches `preview` (see handleSend above), so this stays visibly true on a failed turn instead of only being true by omission. */}
          <p className="mb-2 text-[11px] text-text-3">Reflects the last successfully compiled strategy - unaffected by a failed attempt below.</p>
          <StrategyChartPreview
            symbol={preview.symbol}
            timeframe={preview.timeframe}
            name={preview.name}
            candles={preview.candles}
            indicatorSeries={preview.indicatorSeries}
            activePanels={preview.activePanels}
          />
        </div>
      )}

      {(backtestResult || backtestError) && (
        <div className="border-b border-border px-4 py-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-text-3">Backtest result</p>
          {backtestError && <p className="text-xs text-danger">{backtestError}</p>}
          {backtestResult && <BacktestResultCard run={backtestResult} />}
        </div>
      )}

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
