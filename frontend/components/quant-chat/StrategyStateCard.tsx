// components/quant-chat/StrategyStateCard.tsx
// QP-2 - Conversational Strategy Builder. Renders the current compiler
// result (stages/reachedStage/compiledSpec) plus, when present, the
// deterministic explanation text - real data only, never a fabricated
// "strategy ready" state when compilation actually failed. Quant-specific;
// deliberately not folded into the shared components/ai/* layer, which
// has no equivalent concept.
import { FIN_LABEL, FIN_TERTIARY } from "@/components/ui/financial-typography";
import type { QuantChatMessageStrategyState } from "@/types/quant-chat";

const STAGE_LABEL: Record<string, string> = {
  IMPORTED: "Imported",
  PARSED: "Parsed",
  IR_VALID: "Structure valid",
  EXECUTION_VALID: "Ready to compile",
};

export default function StrategyStateCard({ strategyState }: { strategyState: QuantChatMessageStrategyState }) {
  const { compileResult, explanation } = strategyState;
  const failedStage = compileResult.stages.find((s) => s.outcome === "FAILED");

  return (
    <div className="mt-3 rounded-2xl border border-border bg-ink p-4">
      <div className="flex flex-wrap items-center gap-2">
        {compileResult.stages.map((stage) => (
          <span
            key={stage.stage}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              stage.outcome === "PASSED" ? "bg-signal-up/15 text-signal-up" : stage.outcome === "FAILED" ? "bg-danger/15 text-danger" : "bg-ink-3 text-text-3"
            }`}
          >
            {STAGE_LABEL[stage.stage] ?? stage.stage}
          </span>
        ))}
      </div>

      {compileResult.compiledSpec ? (
        explanation && (
          <p className={`${FIN_TERTIARY} mt-3 whitespace-pre-wrap`}>{explanation}</p>
        )
      ) : (
        <p className={`${FIN_LABEL} mt-3 text-danger`}>{failedStage ? failedStage.detail : "Compilation did not complete."}</p>
      )}
    </div>
  );
}
