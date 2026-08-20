// components/marketplace/sections/HistorySection.tsx
// Sprint M8 - Factual event list only (M8 brief section 13). Never
// manufactures events, and explicitly never says "stable over time" unless
// singleObservationOnly is false (i.e. real longitudinal evidence exists).
import type { HistorySummary } from "@/types/marketplace";

export default function HistorySection({ history }: { history: HistorySummary | null }) {
  return (
    <section aria-labelledby="history-heading" className="rounded-2xl bg-ink-3 border border-border p-6">
      <h2 id="history-heading" className="text-xl font-bold mb-1">
        History
      </h2>
      {history && history.events.length > 0 ? (
        <>
          <ol className="mt-4 space-y-2 border-l border-border pl-4">
            {history.events.map((ev, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium">{ev.eventType.replace(/_/g, " ")}</span>
                <span className="text-text-3"> — observed {new Date(ev.observedAt).toLocaleDateString()}, recorded {new Date(ev.recordedAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-text-3">
            {history.singleObservationOnly
              ? "Single verified historical observation — longitudinal performance history has not yet been established for this Version."
              : `${history.observationCount} independent observations recorded.`}
          </p>
        </>
      ) : (
        <p className="text-sm text-text-3">No AT24 history has been recorded for this listing yet.</p>
      )}
    </section>
  );
}
