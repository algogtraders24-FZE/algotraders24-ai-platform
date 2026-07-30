// components/dashboard/RecentActivity.tsx
// Sprint L2.3 - Real timestamps (real relative-time formatting of a real
// ISO string from the database) and a real, honest empty state, replacing
// 3 hardcoded activity lines shown identically to every user regardless
// of whether they'd ever actually done anything.
import type { ActivityItem } from "@/services/dashboard.service";

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
    <div className="rounded-2xl bg-[#0C1324] border border-[#1F2937] p-6">
      <h3 className="font-bold mb-4">Recent Activity</h3>
      {items.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-gray-400">No activity yet.</p>
          <p className="mt-1 text-xs text-gray-600">
            Ask the AI Assistant a question or upload a document to get started.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 text-sm">
              <span className="text-gray-300">{item.text}</span>
              <span className="shrink-0 text-gray-500">{formatRelativeTime(item.timestamp)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
