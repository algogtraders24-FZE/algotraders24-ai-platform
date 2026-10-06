// app/dashboard/help/page.tsx
// How-to guides hub. Static server page; each guide lives on its own route.
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";

const GUIDES = [
  {
    href: "/dashboard/help/edge-analyzer",
    title: "Edge Analyzer",
    blurb: "Upload your MetaTrader 5 history and see where your results come from, whether they can be told apart from luck, and how much risk the history implies.",
  },
  {
    href: "/dashboard/help/ai-tools",
    title: "AI Tools (MCP)",
    blurb: "Connect AT24's market, backtest and risk tools to your own AI app (for example Claude Code). Read-only; AT24 never places orders.",
  },
];

export default function HelpHubPage() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="ACCOUNT" title="How-to guides" description="Step-by-step guides for AT24 features. Need a person? Use Support in the same menu." />
      <div className="grid gap-4 md:grid-cols-2">
        {GUIDES.map((g) => (
          <Link key={g.href} href={g.href} className="block">
            <Card className="h-full space-y-2 transition hover:border-gold/40">
              <h2 className="text-base font-semibold text-text">{g.title}</h2>
              <p className="text-sm text-text-2">{g.blurb}</p>
              <span className="text-xs font-semibold text-gold">Read the guide →</span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
