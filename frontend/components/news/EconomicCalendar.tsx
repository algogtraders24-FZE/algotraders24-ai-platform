// components/news/EconomicCalendar.tsx
import type { EconomicEvent } from "@/types/economic-event";
import ImpactBadge from "./ImpactBadge";

export default function EconomicCalendar({ events }: { events: EconomicEvent[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-900/60 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3">Event</th>
            <th className="px-4 py-3">Currency</th>
            <th className="px-4 py-3">Impact</th>
            <th className="px-4 py-3">Forecast</th>
            <th className="px-4 py-3">Previous</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {events.map((e) => (
            <tr key={e.id} className="hover:bg-slate-900/40">
              <td className="px-4 py-3 font-medium text-slate-100">{e.title}</td>
              <td className="px-4 py-3 text-slate-400">{e.currency}</td>
              <td className="px-4 py-3"><ImpactBadge level={e.impact} /></td>
              <td className="px-4 py-3 text-slate-400">{e.forecast ?? "—"}</td>
              <td className="px-4 py-3 text-slate-400">{e.previous ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}