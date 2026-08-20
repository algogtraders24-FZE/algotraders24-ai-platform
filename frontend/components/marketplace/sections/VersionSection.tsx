// components/marketplace/sections/VersionSection.tsx
// Sprint M8 - Section 14: each Version has independent Evidence/
// Validation/RiskAnalysis/History/TrustState. This component deliberately
// shows only the CURRENT listing's own version and never implies (visually
// or textually) that a prior/future version's Trust State carries over.
export default function VersionSection({ versionId, tradingSystemId }: { versionId: string | null; tradingSystemId: string | null }) {
  return (
    <section aria-labelledby="version-heading" className="rounded-2xl bg-ink-3 border border-border p-6">
      <h2 id="version-heading" className="text-xl font-bold mb-1">
        Version
      </h2>
      {versionId ? (
        <div className="text-sm text-text-2 space-y-1">
          <p>Version: <span className="font-mono text-text">{versionId}</span></p>
          {tradingSystemId && <p>Trading System: <span className="font-mono text-text">{tradingSystemId}</span></p>}
          <p className="text-xs text-text-3 mt-2">
            All Evidence, Validation, Risk Analysis, History, and Trust State shown on this page belong to this specific Version
            only. A different Version of this same trading system — past or future — has its own independent evidence and Trust
            State; nothing is inherited automatically.
          </p>
        </div>
      ) : (
        <p className="text-sm text-text-3">No TradingSystem Version is linked to this listing yet.</p>
      )}
    </section>
  );
}
