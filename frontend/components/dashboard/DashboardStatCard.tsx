// components/dashboard/DashboardStatCard.tsx
// Sprint L2.3 - The previous version showed a fabricated trend arrow
// ("+2 this week") next to every stat - there's no real historical
// baseline anywhere to compute that from. Dropped rather than replaced
// with a differently-shaped fake number: this card now shows exactly what
// it can honestly show, a real current count.
export interface DashboardStat {
  label: string;
  value: string | number;
}

export default function DashboardStatCard({ stat }: { stat: DashboardStat }) {
  return (
    <div className="rounded-2xl bg-[#0C1324] border border-[#1F2937] p-6">
      <div className="text-gray-400 text-sm">{stat.label}</div>
      <div className="text-3xl font-bold mt-2">{stat.value}</div>
    </div>
  );
}
