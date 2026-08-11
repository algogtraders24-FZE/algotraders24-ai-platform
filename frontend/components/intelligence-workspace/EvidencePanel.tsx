// components/intelligence-workspace/EvidencePanel.tsx
// Sprint D2.6.10 - Trader Intelligence Workspace & Verified Answer
// Experience. Renders real supporting/opposing EvidenceItem[] and any
// real unresolved conflicts (D2.6.1's DecisionContext, unmodified) -
// never a new ranking system (EvidenceRankingService, 15D.4, already
// ordered these server-side). When evidence conflicts, the conflict is
// shown honestly - never folded into a fake single "overall" verdict.
import type { EvidenceItem, EvidenceConflict } from "@/types/evidence";
import { formatLabel } from "./format";

function EvidenceColumn({ title, items, tone }: { title: string; items: EvidenceItem[]; tone: "up" | "down" }) {
  const border = tone === "up" ? "border-signal-up" : "border-signal-down";
  const label = tone === "up" ? "text-signal-up" : "text-signal-down";
  return (
    <div className={`rounded-card border-l-2 ${border}/60 border-y border-r border-border bg-ink-2 p-4`}>
      <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${label}`}>{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-text-3">None available.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={`${item.type}-${item.claim}`} className="text-sm leading-6 text-text-2">
              {item.claim}
              <span className="ml-1.5 font-mono text-[11px] text-text-3">
                — {formatLabel(item.type)} · {item.source}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConflictItem({ conflict }: { conflict: EvidenceConflict }) {
  return (
    <li className="rounded-control border border-warning/30 bg-warning/10 p-3 text-sm leading-6 text-text-2">
      <p>
        <span className="text-text-3">{conflict.itemA.source}: </span>
        {conflict.itemA.claim}
      </p>
      <p>
        <span className="text-text-3">{conflict.itemB.source}: </span>
        {conflict.itemB.claim}
      </p>
      <p className="mt-1 text-xs text-text-3">{conflict.reason}</p>
    </li>
  );
}

export default function EvidencePanel({
  supportingEvidence,
  opposingEvidence,
  unresolvedConflicts,
}: {
  supportingEvidence: EvidenceItem[];
  opposingEvidence: EvidenceItem[];
  unresolvedConflicts: EvidenceConflict[];
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <EvidenceColumn title="Supporting" items={supportingEvidence} tone="up" />
        <EvidenceColumn title="Opposing" items={opposingEvidence} tone="down" />
      </div>
      {unresolvedConflicts.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-warning">
            Unresolved Conflicts ({unresolvedConflicts.length})
          </p>
          <ul className="mt-2 space-y-2">
            {unresolvedConflicts.map((conflict) => (
              <ConflictItem key={`${conflict.itemA.claim}|${conflict.itemB.claim}`} conflict={conflict} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
