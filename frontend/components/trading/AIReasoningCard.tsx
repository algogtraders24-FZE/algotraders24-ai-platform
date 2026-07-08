// components/trading/AIReasoningCard.tsx
interface Props {
  reasoning: string;
  warnings: string[];
  nextActions: string[];
  aiCommentary?: string | null;
}

export default function AIReasoningCard({ reasoning, warnings, nextActions, aiCommentary }: Props) {
  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5">
      <p className="text-sm font-semibold text-indigo-300">AI Reasoning</p>
      <p className="mt-2 text-sm text-slate-300">{reasoning}</p>

      {aiCommentary && (
        <div className="mt-3 rounded-lg bg-slate-950/50 p-3">
          <p className="text-xs font-semibold text-indigo-400">Gemini Commentary</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{aiCommentary}</p>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-amber-400">Warnings</p>
          <ul className="mt-1 list-inside list-disc text-xs text-slate-400">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <p className="text-xs font-semibold text-slate-300">Next Actions</p>
        <ul className="mt-1 list-inside list-disc text-xs text-slate-400">
          {nextActions.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      </div>
    </div>
  );
}