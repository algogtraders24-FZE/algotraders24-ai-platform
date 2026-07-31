// components/admin/UserJourneyTimeline.tsx
// Sprint R1.2 - Phase 3: presentational timeline for a single user's
// onboarding milestones. Every entry is either a real timestamp or an
// honest "not yet reached" / "not tracked" note - never a guessed date.
import type { JourneyEvent } from "@/services/admin/AdminBetaService";

export default function UserJourneyTimeline({ journey }: { journey: JourneyEvent[] }) {
  return (
    <ol className="space-y-0">
      {journey.map((event, i) => {
        const reached = event.occurredAt !== null;
        return (
          <li key={event.key} className="relative flex gap-4 pb-6 last:pb-0">
            {i < journey.length - 1 && (
              <span className="absolute left-[7px] top-4 h-full w-px bg-ink-3" aria-hidden />
            )}
            <span
              className={`relative mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${
                reached ? "border-success bg-success/20" : "border-border bg-ink-2"
              }`}
            />
            <div>
              <p className={`text-sm font-medium ${reached ? "text-text" : "text-text-3"}`}>{event.label}</p>
              <p className="mt-0.5 text-xs text-text-3">
                {reached ? new Date(event.occurredAt as string).toLocaleString() : event.note ?? "Not yet reached."}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
