// components/trading/TradeSetupCard.tsx
import type { TradeSetup } from "@/types/trade-setup";

export default function TradeSetupCard({ setup }: { setup: TradeSetup }) {
  const rows: [string, string | number][] = [
    ["Direction", setup.direction.toUpperCase()],
    ["Entry", setup.entry],
    ["Stop Loss", setup.stopLoss],
    ["Take Profit 1", setup.takeProfit[0]],
    ["Take Profit 2", setup.takeProfit[1] ?? "—"],
    ["Risk / Reward", `${setup.riskReward}`],
    ["Confidence", `${setup.confidence}%`],
  ];
  return (
    <div className="rounded-xl border border-border bg-ink-2 p-4">
      <p className="mb-3 text-sm font-semibold text-text-2">Trade Setup</p>
      <div className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between text-xs">
            <span className="text-text-3">{k}</span>
            <span className="font-medium text-text">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}