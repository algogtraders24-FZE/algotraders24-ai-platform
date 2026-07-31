// components/dashboard/RecentActivity.tsx
// Sprint L2.3 - Real timestamps and a real, honest empty state, replacing
// 3 hardcoded activity lines shown identically to every user regardless
// of whether they'd ever actually done anything.
// Sprint D1.0 - Retrofitted onto Card/EmptyState + tokens.
import type { ActivityItem } from "@/services/dashboard.service";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function RecentActivity({ items }: { items: ActivityItem[] }) {
  return (
    <Card>
      <h3 className="font-bold mb-4 text-text">Recent Activity</h3>
      {items.length === 0 ? (
        <EmptyState title="No activity yet." description="Ask the AI Assistant a question or upload a document to get started." />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 text-sm">
              <span className="text-text-2">{item.text}</span>
              <span className="shrink-0 text-text-3">{formatRelativeTime(item.timestamp)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
