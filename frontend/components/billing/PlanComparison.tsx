"use client";
// components/billing/PlanComparison.tsx
// Sprint 13A — Subscription & Billing Foundation
// Sprint D1.0 - Retrofitted onto the Table primitive + tokens.
import type { Plan, PlanId } from "@/types/billing";
import { COMPARISON_ROWS, PLAN_COLORS, PLAN_LABELS } from "@/config/billing.config";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/ui/Table";

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
      <span className="text-success">✓</span>
    ) : (
      <span className="text-text-3">—</span>
    );
  }
  if (type === "storage") {
    return (
      <span className="text-text-2">{formatStorage(Number(raw))}</span>
    );
  }
  const num = Number(raw);
  const display =
    num >= 100000 ? "Unlimited" : num.toLocaleString();
  return <span className="text-text-2">{display}</span>;
}

export default function PlanComparison({ plans, currentPlanId }: Props) {
  return (
    <Table className="min-w-[640px]">
      <Thead>
        <tr>
          <Th>Features</Th>
          {plans.map((plan) => (
            <Th key={plan.id} className="text-center">
              <span className="font-semibold" style={{ color: PLAN_COLORS[plan.id] }}>
                {PLAN_LABELS[plan.id]}
              </span>
              {plan.id === currentPlanId && (
                <span className="mt-1 block text-[10px] font-medium uppercase tracking-wider text-text-3">
                  Current
                </span>
              )}
            </Th>
          ))}
        </tr>
      </Thead>
      <Tbody>
        {COMPARISON_ROWS.map((row) => (
          <Tr key={row.key}>
            <Td className="text-left font-medium text-text-2">{row.label}</Td>
            {plans.map((plan) => (
              <Td key={plan.id + row.key} className={`text-center ${plan.id === currentPlanId ? "bg-ink-3/40" : ""}`}>
                {renderCell(plan, row.key, row.type)}
              </Td>
            ))}
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
