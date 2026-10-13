// components/macro/MiniGauge.tsx
// The small semicircle gauge shared by the dashboard's Market snapshot and the
// AI Signals cards. Pure presentation: the score and lean come from the server.
import type { AlignmentLean } from "@/services/macro/macro-alignment";

export const LEAN_TEXT: Record<AlignmentLean, string> = {
  supportive: "text-success",
  headwind: "text-danger",
  mixed: "text-warning",
  insufficient: "text-text-2",
};

export function MiniGauge({ score, lean, size = "sm" }: { score: number | null; lean: AlignmentLean; size?: "sm" | "lg" }) {
  return (
    <div className={`relative mx-auto ${size === "lg" ? "w-40" : "w-24"} ${LEAN_TEXT[lean]}`} role="img" aria-label={score === null ? "not enough data" : `${score} percent`}>
      <svg viewBox="0 0 120 70" className="w-full">
        <path d="M10 62 A50 50 0 0 1 110 62" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="12" strokeLinecap="round" pathLength={100} />
        {score !== null && <path d="M10 62 A50 50 0 0 1 110 62" fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" pathLength={100} strokeDasharray={`${score} 100`} />}
      </svg>
      <div className={`absolute inset-x-0 bottom-0 text-center font-semibold leading-none ${size === "lg" ? "text-3xl" : "text-lg"}`}>{score === null ? "—" : `${score}%`}</div>
    </div>
  );
}
