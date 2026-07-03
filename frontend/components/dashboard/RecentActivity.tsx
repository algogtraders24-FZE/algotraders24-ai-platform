import type { ActivityItem } from "@/data/dashboard";

export default function RecentActivity({ items }: { items: ActivityItem[] }) {
  return (
    <div className="rounded-2xl bg-[#0C1324] border border-[#1F2937] p-6">
      <h3 className="font-bold mb-4">Recent Activity</h3>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="flex justify-between text-sm">
            <span className="text-gray-300">{item.text}</span>
            <span className="text-gray-500">{item.time}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}