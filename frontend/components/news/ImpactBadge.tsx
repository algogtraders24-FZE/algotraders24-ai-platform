// components/news/ImpactBadge.tsx
import type { ImpactLevel } from "@/types/news-impact";

const MAP: Record<ImpactLevel, string> = {
  low: "bg-success/15 text-success border-success/30",
  medium: "bg-warning/15 text-warning border-warning/30",
  high: "bg-danger/15 text-danger border-danger/30",
};

export default function ImpactBadge({ level }: { level: ImpactLevel }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${MAP[level]}`}>
      {level}
    </span>
  );
}