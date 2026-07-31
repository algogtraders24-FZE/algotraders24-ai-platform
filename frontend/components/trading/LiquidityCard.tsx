// components/trading/LiquidityCard.tsx
import type { LiquidityZones } from "@/types/technical-analysis";

export default function LiquidityCard({ liquidity }: { liquidity: LiquidityZones }) {
  return (
    <div className="rounded-xl border border-border bg-ink-2 p-4">
      <p className="mb-3 text-sm font-semibold text-text-2">Liquidity</p>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-text-3">Buy-side</p>
          {liquidity.buySide.map((v) => <p key={v} className="text-success">{v}</p>)}
        </div>
        <div>
          <p className="text-text-3">Sell-side</p>
          {liquidity.sellSide.map((v) => <p key={v} className="text-danger">{v}</p>)}
        </div>
        <div>
          <p className="text-text-3">Equal Highs</p>
          {liquidity.equalHighs.map((v) => <p key={v} className="text-text-2">{v}</p>)}
        </div>
        <div>
          <p className="text-text-3">Equal Lows</p>
          {liquidity.equalLows.map((v) => <p key={v} className="text-text-2">{v}</p>)}
        </div>
      </div>
    </div>
  );
}