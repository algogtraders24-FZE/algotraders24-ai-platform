// components/news/EconomicCalendar.tsx
import type { EconomicEvent } from "@/types/economic-event";
import ImpactBadge from "./ImpactBadge";

export default function EconomicCalendar({ events }: { events: EconomicEvent[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-ink-2 text-left text-xs uppercase text-text-3">
          <tr>
            <th className="px-4 py-3">Event</th>
            <th className="px-4 py-3">Currency</th>
            <th className="px-4 py-3">Impact</th>
            <th className="px-4 py-3">Forecast</th>
            <th className="px-4 py-3">Previous</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {events.map((e) => (
            <tr key={e.id} className="hover:bg-ink-2">
              <td className="px-4 py-3 font-medium text-text">{e.title}</td>
              <td className="px-4 py-3 text-text-2">{e.currency}</td>
              <td className="px-4 py-3"><ImpactBadge level={e.impact} /></td>
              <td className="px-4 py-3 text-text-2">{e.forecast ?? "—"}</td>
              <td className="px-4 py-3 text-text-2">{e.previous ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}