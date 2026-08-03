"use client";

// components/workspace/GlobalSymbolSelector.tsx
// Sprint D2.3 (Phase 2) - Addition 2. The single symbol control for the whole
// workspace: changing it updates every panel (chart, AI intelligence,
// indicators, evidence, assistant, research) because they all read the shared
// WorkspaceContext. Options are the registry's enabled markets, so it can never
// offer a symbol no provider serves.
import { useWorkspace } from "@/context/WorkspaceContext";
import { listEnabledMarkets } from "@/lib/market-data/market-registry";

const MARKETS = listEnabledMarkets();

export default function GlobalSymbolSelector() {
  const { symbol, setSymbol } = useWorkspace();
  return (
    <label className="inline-flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wider text-text-3">Symbol</span>
      <select
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        aria-label="Workspace symbol"
        className="rounded-control border border-border bg-ink-2 px-3 py-1.5 text-sm font-semibold text-text focus-visible:border-gold"
      >
        {MARKETS.map((m) => (
          <option key={m.symbol} value={m.symbol}>
            {m.symbol} · {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}
