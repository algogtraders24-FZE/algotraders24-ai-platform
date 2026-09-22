// components/ui/StatCard.tsx
// Sprint UI-01 - AT24 Premium UI Foundation. The one KPI tile. Replaces the
// per-page hand-rolled stat cards (DashboardStatCard, and the local
// `StatCard` functions elsewhere) with a single primitive on the Card
// surface + token scale.
//
// Deliberately has NO delta / trend / sparkline (UI-01 sign-off): the
// platform has no historical baseline to compute a real change from, and a
// fabricated "+2 this week" was removed for exactly that reason in L2.3.
// When real time-series exist, add an optional `trend` prop here - callers
// won't change.
import type { ComponentType } from "react";
import Link from "next/link";
import Card from "./Card";
import InfoTooltip from "./InfoTooltip";

export interface StatCardProps {
  label: string;
  /** Pre-formatted for display. Numbers render with tabular figures. */
  value: string | number;
  /** Optional "what is this" guidance - renders the (i) affordance. */
  hint?: string;
  /** Optional lucide (or compatible) icon component, shown top-right. */
  icon?: ComponentType<{ size?: number; className?: string }>;
  /** When set, the whole tile is a link to this route. */
  href?: string;
  className?: string;
}

export default function StatCard({ label, value, hint, icon: Icon, href, className = "" }: StatCardProps) {
  const body = (
    <Card padding="md" className={["h-full", href ? "transition hover:border-gold/40" : "", className].filter(Boolean).join(" ")}>
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center text-xs font-medium text-text-3">
          {label}
          {hint && <InfoTooltip label={label} text={hint} />}
        </span>
        {Icon && <Icon size={16} className="shrink-0 text-text-3" />}
      </div>
      <div className="fin-num mt-2 text-3xl font-bold text-text">{value}</div>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full rounded-card focus-visible:outline-none">
        {body}
      </Link>
    );
  }
  return body;
}
