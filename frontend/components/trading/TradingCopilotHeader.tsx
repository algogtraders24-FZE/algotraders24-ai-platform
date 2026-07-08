// components/trading/TradingCopilotHeader.tsx
"use client";

import { mockMarket } from "@/data/mock-market";

interface Props {
  symbol: string;
  onSymbolChange: (s: string) => void;
  onAnalyze: () => void;
  loading: boolean;
}

export default function TradingCopilotHeader({ symbol, onSymbolChange, onAnalyze, loading }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">AI Trading Copilot</h1>
        <p className="text-xs text-slate-500">Mock analysis · Gemini commentary</p>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={symbol}
          onChange={(e) => onSymbolChange(e.target.value)}
          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/50"
        >
          {mockMarket.map((m) => (
            <option key={m.symbol} value={m.symbol}>{m.symbol} — {m.name}</option>
          ))}
        </select>
        <button
          onClick={onAnalyze}
          disabled={loading}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {loading ? "Analyzing..." : "Analyze"}
        </button>
      </div>
    </div>
  );
}