"use client";
// components/billing/UsageCard.tsx
// Sprint 13A — Subscription & Billing Foundation

import { useEffect, useState } from "react";
import type { UsageMetric } from "@/types/billing";
import { usageService } from "@/services/billing/UsageService";

interface Props {
  metrics: UsageMetric[];
}

const LEVEL_COLORS: Record<"ok" | "warning" | "critical", string> = {
  ok: "#38bdf8",
  warning: "#fbbf24",
  critical: "#f87171",
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

  const limitLabel =
    metric.limit < 0 ? "∞" : metric.limit.toLocaleString();

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-slate-300">{metric.label}</span>
        <span className="text-slate-400">
          {metric.used.toLocaleString()}
          <span className="text-slate-600"> / {limitLabel} {metric.unit}</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: width + "%", backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export default function UsageCard({ metrics }: Props) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <h3 className="mb-5 text-lg font-semibold text-white">Usage Overview</h3>
      <div className="space-y-4">
        {metrics.map((m) => (
          <UsageBar key={m.label} metric={m} />
        ))}
      </div>
    </div>
  );
}
