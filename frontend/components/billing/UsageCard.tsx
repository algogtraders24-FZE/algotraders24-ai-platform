"use client";
// components/billing/UsageCard.tsx
// Sprint 13A — Subscription & Billing Foundation
// Sprint D1.0 - Retrofitted onto Card + tokens. LEVEL_COLORS now reference
// the real CSS custom properties (--info/--warning/--danger) instead of a
// separate hardcoded hex triplet that happened to look similar.
import { useEffect, useState } from "react";
import type { UsageMetric } from "@/types/billing";
import { usageService } from "@/services/billing/UsageService";
import Card from "@/components/ui/Card";

const LEVEL_COLORS: Record<"ok" | "warning" | "critical", string> = {
  ok: "var(--info)",
  warning: "var(--warning)",
  critical: "var(--danger)",
};

function UsageBar({ metric }: { metric: UsageMetric }) {
  const pct = usageService.pct(metric.used, metric.limit);
  const level = usageService.level(metric.used, metric.limit);
  const color = LEVEL_COLORS[level];
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setWidth(pct), 80);
    return () => clearTimeout(t);
  }, [pct]);

  // Sprint L2.5 - a metric with no real instrumentation yet is disclosed
  // honestly, never shown as a fabricated 0-of-something bar.
  if (!metric.tracked) {
    return (
      <div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-2">{metric.label}</span>
          <span className="text-xs text-text-3">Not yet tracked</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-ink-3" />
      </div>
    );
  }

  const limitLabel =
    metric.limit < 0 ? "∞" : metric.limit.toLocaleString();

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-text-2">{metric.label}</span>
        <span className="text-text-3">
          {metric.used.toLocaleString()}
          <span className="text-text-3"> / {limitLabel} {metric.unit}</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-3">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: width + "%", backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export default function UsageCard({ metrics }: { metrics: UsageMetric[] }) {
  return (
    <Card>
      <h3 className="mb-5 text-lg font-semibold text-text">Usage Overview</h3>
      <div className="space-y-4">
        {metrics.map((m) => (
          <UsageBar key={m.label} metric={m} />
        ))}
      </div>
    </Card>
  );
}
