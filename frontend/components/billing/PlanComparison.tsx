"use client";
// components/billing/PlanComparison.tsx
// Sprint 13A — Subscription & Billing Foundation

import type { Plan, PlanId } from "@/types/billing";
import { COMPARISON_ROWS, PLAN_COLORS, PLAN_LABELS } from "@/config/billing.config";

interface Props {
  plans: Plan[];
  currentPlanId: PlanId;
}

function formatStorage(mb: number): string {
  if (mb >= 1000) {
    const gb = mb / 1000;
    return (gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)) + " GB";
  }
  return mb + " MB";
}

function renderCell(
  plan: Plan,
  key: string,
  type: "number" | "boolean" | "storage"
): React.ReactNode {
  const raw = (plan as unknown as Record<string, unknown>)[key];

  if (type === "boolean") {
    return raw ? (
      <span className="text-emerald-400">✓</span>
    ) : (
      <span className="text-slate-600">—</span>
    );
  }
  if (type === "storage") {
    return (
      <span className="text-slate-200">{formatStorage(Number(raw))}</span>
    );
  }
  const num = Number(raw);
  const display =
    num >= 100000 ? "Unlimited" : num.toLocaleString();
  return <span className="text-slate-200">{display}</span>;
}

export default function PlanComparison({ plans, currentPlanId }: Props) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-white/10">
            <th className="px-5 py-4 text-left font-medium text-slate-400">
              Features
            </th>
            {plans.map((plan) => (
              <th key={plan.id} className="px-5 py-4 text-center">
                <span
                  className="font-semibold"
                  style={{ color: PLAN_COLORS[plan.id] }}
                >
                  {PLAN_LABELS[plan.id]}
                </span>
                {plan.id === currentPlanId && (
                  <span className="mt-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
                    Current
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARISON_ROWS.map((row, idx) => (
            <tr
              key={row.key}
              className={
                idx % 2 === 0 ? "bg-transparent" : "bg-white/[0.02]"
              }
            >
              <td className="px-5 py-3 text-left font-medium text-slate-300">
                {row.label}
              </td>
              {plans.map((plan) => (
                <td
                  key={plan.id + row.key}
                  className={`px-5 py-3 text-center ${
                    plan.id === currentPlanId ? "bg-white/[0.03]" : ""
                  }`}
                >
                  {renderCell(plan, row.key, row.type)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
