// components/publishing/ContentCalendar.tsx
import type { ScheduledContent } from "@/services/ai/publishing/content-planner.service";

export default function ContentCalendar({ schedule }: { schedule: ScheduledContent[] }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-slate-300">Content Calendar</p>
      <div className="space-y-2">
        {schedule.map((s, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="capitalize text-slate-300">{s.category.replace(/-/g, " ")}</span>
            <span className="text-slate-500">{s.time}</span>
            <span className={`rounded px-1.5 py-0.5 ${s.priority === 1 ? "bg-red-500/15 text-red-400" : "bg-slate-700/40 text-slate-400"}`}>P{s.priority}</span>
          </div>
        ))}
      </div>
    </div>
  );
}