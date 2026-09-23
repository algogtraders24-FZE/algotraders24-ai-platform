// components/publishing/SEOScoreCard.tsx
// Sprint UI-03 - hand-rolled rounded-xl recipe -> Card (padding="sm" is the
// same p-4).
import Card from "@/components/ui/Card";

export default function SEOScoreCard({ score }: { score: number }) {
  const color = score >= 80 ? "bg-success" : score >= 70 ? "bg-warning" : "bg-danger";
  const label = score >= 80 ? "Strong" : score >= 70 ? "Good" : "Needs work";
  return (
    <Card padding="sm">
      <p className="text-xs text-text-3">SEO Score</p>
      <p className="mt-1 text-2xl font-bold text-text">{score}</p>
      <div className="mt-3 h-2 w-full rounded-full bg-ink-3">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <p className="mt-1 text-xs text-text-3">{label}</p>
    </Card>
  );
}