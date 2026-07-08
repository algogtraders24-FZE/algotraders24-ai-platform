// components/trading/LiquidityCard.tsx
import type { LiquidityZones } from "@/types/technical-analysis";

export default function LiquidityCard({ liquidity }: { liquidity: LiquidityZones }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-slate-300">Liquidity</p>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-slate-500">Buy-side</p>
          {liquidity.buySide.map((v) => <p key={v} className="text-emerald-400">{v}</p>)}
        </div>
        <div>
          <p className="text-slate-500">Sell-side</p>
          {liquidity.sellSide.map((v) => <p key={v} className="text-red-400">{v}</p>)}
        </div>
        <div>
          <p className="text-slate-500">Equal Highs</p>
          {liquidity.equalHighs.map((v) => <p key={v} className="text-slate-300">{v}</p>)}
        </div>
        <div>
          <p className="text-slate-500">Equal Lows</p>
          {liquidity.equalLows.map((v) => <p key={v} className="text-slate-300">{v}</p>)}
        </div>
      </div>
    </div>
  );
}