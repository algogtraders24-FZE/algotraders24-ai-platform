// components/dashboard/DashboardStatCard.tsx
// Sprint L2.3 - The previous version showed a fabricated trend arrow
// ("+2 this week") next to every stat - there's no real historical
// baseline anywhere to compute that from. Dropped rather than replaced
// with a differently-shaped fake number: this card now shows exactly what
// it can honestly show, a real current count.
// Sprint D1.0 - Retrofitted onto the Card primitive/token system
// (bg-[#0C1324]/border-[#1F2937] -> Card's ink-2/border).
// Beta content pass - added an optional `hint` (native title tooltip) so
// labels like "Indexed Chunks" that are meaningful RAG terminology but not
// obvious to a trader can carry a plain-language explanation without
// inventing a new tooltip component.
import Card from "@/components/ui/Card";

export interface DashboardStat {
  label: string;
  value: string | number;
  hint?: string;
}

export default function DashboardStatCard({ stat }: { stat: DashboardStat }) {
  return (
    <Card>
      <div className="text-text-3 text-sm" title={stat.hint}>
        {stat.label}
      </div>
      <div className="text-3xl font-bold mt-2 text-text">{stat.value}</div>
    </Card>
  );
}
