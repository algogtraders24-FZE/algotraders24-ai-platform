// components/trading/AIReasoningCard.tsx
interface Props {
  reasoning: string;
  warnings: string[];
  nextActions: string[];
  aiCommentary?: string | null;
}

export default function AIReasoningCard({ reasoning, warnings, nextActions, aiCommentary }: Props) {
  return (
    <div className="rounded-xl border border-gold/30 bg-gold/5 p-5">
      <p className="text-sm font-semibold text-gold">AI Reasoning</p>
      <p className="mt-2 text-sm text-text-2">{reasoning}</p>

      {aiCommentary && (
        <div className="mt-3 rounded-lg bg-ink p-3">
          <p className="text-xs font-semibold text-gold">Gemini Commentary</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-text-2">{aiCommentary}</p>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-warning">Warnings</p>
          <ul className="mt-1 list-inside list-disc text-xs text-text-2">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <p className="text-xs font-semibold text-text-2">Next Actions</p>
        <ul className="mt-1 list-inside list-disc text-xs text-text-2">
          {nextActions.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      </div>
    </div>
  );
}