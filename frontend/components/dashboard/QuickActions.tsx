import Link from "next/link";

const ACTIONS = [
  { label: "Browse Products", href: "/products", icon: "📦" },
  { label: "My Downloads", href: "/dashboard/downloads", icon: "⬇️" },
  { label: "My Licenses", href: "/dashboard/licenses", icon: "🔑" },
  { label: "Support", href: "/contact", icon: "💬" },
];

export default function QuickActions() {
  return (
    <div className="rounded-2xl bg-[#0C1324] border border-[#1F2937] p-6">
      <h3 className="font-bold mb-4">Quick Actions</h3>
      <div className="grid grid-cols-2 gap-3">
        {ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex items-center gap-2 rounded-xl bg-[#111827] border border-[#1F2937] px-4 py-3 text-sm hover:border-blue-500 transition"
          >
            <span>{a.icon}</span>
            {a.label}
          </Link>
        ))}
      </div>
    </div>
  );
}