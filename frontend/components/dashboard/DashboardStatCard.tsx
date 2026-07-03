import type { DashboardStat } from "@/data/dashboard";

export default function DashboardStatCard({ stat }: { stat: DashboardStat }) {
  return (
    <div className="rounded-2xl bg-[#0C1324] border border-[#1F2937] p-6">
      <div className="text-gray-400 text-sm">{stat.label}</div>
      <div className="text-3xl font-bold mt-2">{stat.value}</div>
      <div className={`text-sm mt-1 ${stat.up ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
        {stat.up ? "▲" : "▼"} {stat.change}
      </div>
    </div>
  );
}