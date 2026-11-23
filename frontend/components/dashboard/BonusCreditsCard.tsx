// components/dashboard/BonusCreditsCard.tsx
// Checklist of the verification steps that earn one-time bonus AI credits, plus what is left. Server component (no state).
// Hidden once every step is done and nothing is left to spend. Rules and amounts: lib/credits/bonus.ts.
import Link from "next/link";
import Badge from "@/components/ui/Badge";
import { BONUS_EXPIRY_DAYS, BONUS_RULES, CHECKLIST_KINDS, type BonusKind } from "@/lib/credits/bonus";
import type { BonusSummary } from "@/services/credits/bonusCredits";

const STEP_HREF: Partial<Record<BonusKind, string>> = {
  KYC_VERIFIED: "/dashboard/settings",
  TELEGRAM_LINKED: "/dashboard/alerts",
};

export default function BonusCreditsCard({ summary, emailVerified }: { summary: BonusSummary; emailVerified: boolean }) {
  const done = (k: BonusKind) => summary.earned.includes(k) || (k === "EMAIL_VERIFIED" && emailVerified);
  const allDone = CHECKLIST_KINDS.every(done);
  if (allDone && summary.remaining === 0) return null;

  const left = CHECKLIST_KINDS.filter((k) => !done(k));
  const leftCredits = left.reduce((sum, k) => sum + BONUS_RULES[k].amount, 0);
  return (
    <details className="group rounded-panel border border-border bg-ink-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm marker:hidden">
        <span className="font-semibold text-text">Bonus AI credits</span>
        <span className="text-text-2">
          {left.length > 0 ? `${left.length} step${left.length === 1 ? "" : "s"} left (+${leftCredits} credits)` : "All steps done"}
          {summary.remaining > 0 ? ` · ${summary.remaining} credits left` : ""}
        </span>
        <span className="text-gold group-open:hidden">View steps</span>
        <span className="hidden text-gold group-open:inline">Hide</span>
      </summary>
      <div className="space-y-4 border-t border-border p-4">
      <div>
        <h2 className="text-base font-semibold text-text">Earn bonus AI credits</h2>
        <p className="mt-1 text-sm text-text-2">Complete these steps for extra AI messages. Each step pays once.</p>
      </div>
      <ul className="divide-y divide-border">
        {CHECKLIST_KINDS.map((k) => {
          const rule = BONUS_RULES[k];
          const isDone = done(k);
          const href = STEP_HREF[k];
          return (
            <li key={k} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">{rule.label}</p>
                <p className="text-xs text-text-3">{rule.hint}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-gold">+{rule.amount} credits</span>
                {isDone ? (
                  <Badge tone="success">Done</Badge>
                ) : href ? (
                  <Link href={href} className="text-sm font-semibold text-gold hover:underline">Do this</Link>
                ) : (
                  <Badge tone="neutral">Check your email</Badge>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs leading-5 text-text-3">
        {summary.remaining > 0
          ? `Bonus credits left: ${summary.remaining}${summary.nextExpiry ? `, the next ones expire on ${new Date(summary.nextExpiry).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}` : ""}. `
          : ""}
        One credit is one AI message. Bonus credits are used only after your monthly allowance runs out, expire {BONUS_EXPIRY_DAYS} days after you earn them, and cannot be exchanged for cash or transferred.
      </p>
      </div>
    </details>
  );
}
