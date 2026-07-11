"use client";
// components/billing/PaymentMethods.tsx
// Sprint 13A — Subscription & Billing Foundation

import type { PaymentMethod } from "@/types/billing";
import { PAYMENT_METHOD_LABELS } from "@/config/billing.config";

interface Props {
  methods: PaymentMethod[];
}

function MethodIcon({ type }: { type: PaymentMethod["type"] }) {
  const glyph = type === "card" ? "💳" : type === "crypto" ? "◈" : "🅿";
  return (
    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-white/10 bg-white/5 text-lg">
      {glyph}
    </span>
  );
}

function formatExpiry(m: PaymentMethod): string | null {
  if (m.expiryMonth == null || m.expiryYear == null) return null;
  const mm = String(m.expiryMonth).padStart(2, "0");
  return mm + "/" + String(m.expiryYear).slice(-2);
}

export default function PaymentMethods({ methods }: Props) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <div className="mb-5 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Payment Methods</h3>
        <button className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10">
          + Add Method
        </button>
      </div>

      <div className="space-y-3">
        {methods.map((m) => {
          const expiry = formatExpiry(m);
          return (
            <div
              key={m.id}
              className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-white/20"
            >
              <MethodIcon type={m.type} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-200">{m.brand}</span>
                  <span className="text-xs text-slate-500">
                    {PAYMENT_METHOD_LABELS[m.type]}
                  </span>
                  {m.isDefault && (
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                      Default
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-slate-500">
                  {m.type === "crypto" ? "Wallet ••••" : "•••• •••• •••• "}
                  {m.last4}
                  {expiry && <span className="ml-2">exp {expiry}</span>}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
