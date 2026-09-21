"use client";

// app/dashboard/quant-chat/QuantChatClient.tsx
// QP-2 - Conversational Strategy Builder's dedicated route. Reuses the
// existing components/ai/* chat shell (ChatWindow/ChatInput/
// ThinkingIndicator/PromptSuggestions) - the same additive-prop
// extensions ChatWindow/PromptSuggestions/MessageBubble gained for this
// sprint keep every existing K-series caller unaffected. Deliberately
// does NOT reuse ConversationSidebar: that component's rename/pin/
// archive/delete affordances assume a persisted, multi-conversation
// store (StoredConversation), which QP-2's locked in-memory-only-for-v1
// decision doesn't have - a single active conversation, lost on refresh,
// exactly as that decision states.
//
// Quant Pro production launch - this file is the QP-2/3/4/5 UI, unchanged
// except for its own filename/export name. It moved from page.tsx into
// this plain client component because the route now needs a server-side
// entitlement gate in front of it (page.tsx checks hasQuantProAccess()
// and renders either this component or QuantProUpgradeGate) - client
// components can't perform that DB check themselves, and per the launch's
// own access-control requirement, client-side UI is never the real
// authorization boundary (the /strategy-builder and /ai-runs routes this
// component calls enforce the same check server-side independently).
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
//
// QP-5 (docs/architecture/QP5_RECONCILIATION_DECISION.md) - Strategy
// lineage. `latestPersistedStrategyId` is this conversation's own
// most-recently-persisted Strategy.id (D2: set only on a SUCCESSFUL Run
// Backtest, never on MODIFY - MODIFY stays purely in-memory, exactly as
// QP-2 already locked). It is sent as `parentStrategyId` on the NEXT Run
// Backtest so the server can link a semantically-new Strategy artifact to
// whichever one preceded it in this conversation - the server remains
// authoritative (re-verifies ownership, ignores an invalid id) per the
// locked contract; the client only ever remembers an opaque id, never
// reconstructs identity itself. Kept as page-local state (the same
// pattern QP-4 already established for `backtestResult`), NOT added to
// QuantChatConversationState itself - that type round-trips through
// quant-strategy-builder.service.ts's compile-only MODIFY endpoint, which
// has no reason to read or write a Run-Backtest-only concern, and D3
// locked that QP-2's in-memory contract stays untouched.
// `backtestResultIntent` records which `currentIntent` the currently-shown
// `backtestResult` actually ran against, so the UI can tell (D5) whether
// the conversation has since moved on - mirroring QP-3's own already-
// validated "keep it visible, but explicitly re-label" resolution to the
// identical staleness problem for the chart preview.
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

export default function QuantChatClient() {
  const [conversationState, setConversationState] = useState<QuantChatConversationState>(EMPTY_QUANT_CHAT_STATE);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [chatMode, setChatMode] = useState<"modify" | "explain">("modify");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>(undefined);
  const [backtestResult, setBacktestResult] = useState<AlgoTestRunView | undefined>(undefined);
  const [backtestResultIntent, setBacktestResultIntent] = useState<string | undefined>(undefined);
  const [backtestRunning, setBacktestRunning] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [latestPersistedStrategyId, setLatestPersistedStrategyId] = useState<string | undefined>(undefined);

  function pushMessage(msg: DisplayMessage) {
    setMessages((prev) => [...prev, msg]);
  }

  async function handleRunBacktest() {
    if (backtestRunning) return; // prevent duplicate submissions
    setBacktestRunning(true);
    setBacktestError(null);
    const intentAtRequestTime = conversationState.currentIntent;
    try {
      const request = buildQuantChatBacktestRequest(intentAtRequestTime, new Date(), latestPersistedStrategyId);
      const run = await compileAndRunAiStrategy(request);
      setBacktestResult(run);
      setBacktestResultIntent(intentAtRequestTime);
      // D2/D9 - only a genuinely successful run advances the conversation's
      // own lineage pointer; a failed run (compile or execution) leaves
      // latestPersistedStrategyId exactly as it was, never corrupted with
      // an id from a run that didn't actually complete.
      if (run.status === "completed" && run.strategyRefId) setLatestPersistedStrategyId(run.strategyRefId);
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
          {/* QP-5 (D5) - the result itself is never cleared or replaced by a
              later MODIFY (it remains a genuinely accurate record of what
              was actually run, traceable via its own strategyRefId/
              strategyHash) - only its label changes, once the conversation's
              currentIntent has diverged from whatever intent this specific
              result was produced from. Mirrors QP-3's own already-validated
              caption pattern for the chart preview's identical problem. */}
          {backtestResult && backtestResultIntent !== undefined && backtestResultIntent !== conversationState.currentIntent && (
            <p className="mb-2 text-[11px] text-text-3">This backtest reflects the previous strategy. Run Backtest again to test the current modified strategy.</p>
          )}
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
