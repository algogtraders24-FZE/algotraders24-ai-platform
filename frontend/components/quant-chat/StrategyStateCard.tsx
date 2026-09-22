// components/quant-chat/StrategyStateCard.tsx
// QP-2 - Conversational Strategy Builder. Renders the current compiler
// result (stages/reachedStage/compiledSpec) plus, when present, the
// deterministic explanation text - real data only, never a fabricated
// "strategy ready" state when compilation actually failed. Quant-specific;
// deliberately not folded into the shared components/ai/* layer, which
// has no equivalent concept.
import { FIN_LABEL, FIN_TERTIARY } from "@/components/ui/financial-typography";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import type { QuantChatMessageStrategyState } from "@/types/quant-chat";

const STAGE_LABEL: Record<string, string> = {
  IMPORTED: "Imported",
  PARSED: "Parsed",
  IR_VALID: "Structure valid",
  EXECUTION_VALID: "Ready to compile",
};

// Sprint UI-02.2 - was a hand-rolled pill re-deriving Badge's own tone
// logic (PASSED/FAILED/neutral). The outer card keeps its own
// rounded-2xl/bg-ink recipe - this renders inside a chat message bubble,
// a deliberately different "sits on canvas" tone from a page-level Card.
function stageTone(outcome: string): BadgeTone {
  if (outcome === "PASSED") return "success";
  if (outcome === "FAILED") return "danger";
  return "neutral";
}

export default function StrategyStateCard({ strategyState }: { strategyState: QuantChatMessageStrategyState }) {
  const { compileResult, explanation } = strategyState;
  const failedStage = compileResult.stages.find((s) => s.outcome === "FAILED");

  return (
    <div className="mt-3 rounded-2xl border border-border bg-ink p-4">
      <div className="flex flex-wrap items-center gap-2">
        {compileResult.stages.map((stage) => (
          <Badge key={stage.stage} tone={stageTone(stage.outcome)}>
            {STAGE_LABEL[stage.stage] ?? stage.stage}
          </Badge>
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
