// components/publishing/ContentCalendar.tsx
import type { ScheduledContent } from "@/services/ai/publishing/content-planner.service";

export default function ContentCalendar({ schedule }: { schedule: ScheduledContent[] }) {
  return (
    <div className="rounded-xl border border-border bg-ink-2 p-4">
      <p className="mb-3 text-sm font-semibold text-text-2">Content Calendar</p>
      <div className="space-y-2">
        {schedule.map((s, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="capitalize text-text-2">{s.category.replace(/-/g, " ")}</span>
            <span className="text-text-3">{s.time}</span>
            <span className={`rounded px-1.5 py-0.5 ${s.priority === 1 ? "bg-danger/15 text-danger" : "bg-ink-3 text-text-2"}`}>P{s.priority}</span>
          </div>
        ))}
      </div>
    </div>
  );
}