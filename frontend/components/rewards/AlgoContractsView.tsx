// components/rewards/AlgoContractsView.tsx
// The Algo Contracts page, drawn from plain data (lib/rewards/viewModel.ts). No database access here, so it can be previewed with
// mock data. Money shown is always fixed in the contract; nothing here is a forecast or a promise about trading results.
import {
  ArrowRight, BadgeCheck, CalendarClock, CheckCircle2, Circle, Clock, Download, FileText, Gem, Lock, PauseCircle, ShieldCheck, Users, Wallet,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import ButtonLink from "@/components/ui/ButtonLink";
import MemberBadge from "@/components/rewards/MemberBadge";
import BuyContract from "@/components/rewards/BuyContract";
import ReferralCard from "@/components/rewards/ReferralCard";
import WithdrawCard from "@/components/rewards/WithdrawCard";
import { BADGE_TIERS } from "@/lib/rewards/badge";
import { formatUsd } from "@/lib/rewards/money";
import type { AlgoContractsVM, ContractVM, ProductVM } from "@/lib/rewards/viewModel";

const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const dayMonth = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function SectionTitle({ icon: Icon, title, hint }: { icon: typeof Gem; title: string; hint?: string }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex items-center gap-2">
        <Icon size={18} className="text-gold" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-text">{title}</h2>
      </div>
      {hint && <p className="hidden text-xs text-text-3 sm:block">{hint}</p>}
    </div>
  );
}

// ---------- status ----------
function StatusStrip({ vm }: { vm: AlgoContractsVM }) {
  const { proOk, kycOk } = vm.eligibility;
  const ready = proOk && kycOk;
  const items = [
    { done: proOk, label: "Active paid Pro plan", hint: "A plan granted without a payment does not qualify.", href: "/dashboard/billing", cta: "Go to billing" },
    {
      done: kycOk,
      label: "Identity verified (KYC)",
      hint: vm.eligibility.kycAvailable ? "Required to buy any contract. One-time ID and selfie check; AT24 never stores your document." : "Required to buy any contract. The verification service is not switched on yet, so contracts open after it is.",
      href: "/dashboard/settings",
      cta: vm.eligibility.kycAvailable ? "Verify identity" : "",
    },
  ];
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${ready ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
            {ready ? <BadgeCheck size={22} aria-hidden="true" /> : <Lock size={20} aria-hidden="true" />}
          </div>
          <div>
            <p className="text-base font-semibold text-text">{ready ? "You are eligible" : "Two steps to unlock contracts"}</p>
            <p className="text-xs text-text-3">{ready ? "Pick a contract below. Slots are limited each month." : "Finish the steps below. You can look around in the meantime."}</p>
          </div>
        </div>
        {vm.badge && <MemberBadge tier={vm.badge.tier} dimmed={vm.badge.dimmed} />}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.label} className={`flex items-center justify-between gap-3 rounded-card border p-3 ${i.done ? "border-success/30 bg-success/5" : "border-border"}`}>
            <div className="flex items-start gap-2.5">
              {i.done ? <CheckCircle2 size={18} className="mt-0.5 text-success" aria-hidden="true" /> : <Circle size={18} className="mt-0.5 text-text-3" aria-hidden="true" />}
              <div>
                <p className="text-sm font-medium text-text">{i.label}</p>
                <p className="text-xs text-text-3">{i.hint}</p>
              </div>
            </div>
            {i.done ? <Badge tone="success">Done</Badge> : i.cta ? <ButtonLink href={i.href} variant="secondary" size="sm">{i.cta}</ButtonLink> : <Badge tone="neutral">Not open yet</Badge>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------- how it works ----------
function HowItWorks({ hasMoney }: { hasMoney: boolean }) {
  const steps = [
    { icon: ShieldCheck, href: "#choose-contract", title: "Choose a contract", text: "24 months, one AI Algo for MetaTrader 5 and MetaTrader 4." },
    { icon: Download, href: "#your-contracts", title: "Get your files", text: "The EA, a signed licence and your contract PDF, right after payment." },
    { icon: CalendarClock, href: "#your-contracts", title: "Rebate every quarter", text: "A fixed amount, written in your contract, credited every 3 months as set out in your contract." },
    { icon: Wallet, href: hasMoney ? "#balance" : "/dashboard/algo-contracts/guide", title: "Withdraw in USDT", text: "Credited amounts can be withdrawn after a short hold." },
  ];
  return (
    <section className="space-y-3">
      <SectionTitle icon={Gem} title="How it works" />
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, n) => (
          <li key={s.title} className="relative">
            <a href={s.href} className="block h-full rounded-card border border-border bg-ink-2 p-4 transition-colors hover:border-gold/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">
              <span className="absolute right-3 top-3 text-xs font-semibold text-text-3">{n + 1}</span>
              <s.icon size={20} className="text-gold" aria-hidden="true" />
              <p className="mt-2 text-sm font-semibold text-text">{s.title}</p>
              <p className="mt-1 text-xs text-text-3">{s.text}</p>
            </a>
          </li>
        ))}
      </ol>
      <p className="text-xs text-text-3">The rebate is a fixed part of the price you paid. It does not depend on trading results, on AT24 revenue, or on any other customer.</p>
    </section>
  );
}

// ---------- contract cards ----------
function RebateRail({ p }: { p: ProductVM }) {
  const short = p.intervalDays < 30; // the owner-only test contract pays one instalment a day
  const months = p.rail.map((r) => r.at);
  return (
    <div>
      <div className="relative flex items-center justify-between px-1">
        <span className="absolute left-2 right-2 top-1/2 h-px -translate-y-1/2 bg-border" aria-hidden="true" />
        {months.map((m) => (
          <span key={m} className="relative z-10 h-2.5 w-2.5 rounded-full border border-gold bg-ink-2" aria-hidden="true" />
        ))}
      </div>
      {p.rail.length > 6 ? (
        <div className="mt-2 flex justify-between text-[11px] text-text-3">
          <span>{formatUsd(p.rail[0].amountCents)} · month {p.rail[0].at}</span>
          <span>{formatUsd(p.rail[p.rail.length - 1].amountCents)} · month {p.rail[p.rail.length - 1].at}</span>
        </div>
      ) : (
      <div className="mt-2 grid text-center" style={{ gridTemplateColumns: `repeat(${p.installments}, minmax(0, 1fr))` }}>
        {p.rail.map((r) => (
          <div key={r.at}>
            <p className="text-xs font-semibold text-text">{formatUsd(r.amountCents)}</p>
            <p className="text-[11px] text-text-3">{short ? "day" : "month"} {r.at}</p>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

function ContractCard({ p }: { p: ProductVM }) {
  const color = BADGE_TIERS[p.key].color;
  const slot = p.slot;
  const used = slot && slot.opened ? Math.max(0, slot.limit - slot.remaining) : 0;
  const short = p.intervalDays < 30; // the owner-only test contract pays one instalment a day
  return (
    <Card padding="none" className="flex flex-col overflow-hidden">
      <div className="h-1.5" style={{ background: color }} aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-text">{p.name}</h3>
            <p className="text-xs text-text-3">{p.tagline}</p>
          </div>
          <MemberBadge tier={p.key} showLabel={false} />
        </div>

        <div className="rounded-card border border-border bg-ink p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-text-3">Price</span>
            <span className="text-sm text-text-2">{formatUsd(p.listPriceCents)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-text-3">Rebate back to you</span>
            <span className="text-sm text-success">− {formatUsd(p.rebateTotalCents)}</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
            <span className="text-xs font-medium text-text-2">{p.netPriceCents < 0 ? "Net after rebate (credit to you)" : "Net price"}</span>
            <span className="text-2xl font-semibold text-text">{formatUsd(Math.abs(p.netPriceCents))}</span>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-text-2">{p.monthlyRebateCents !== null ? `${formatUsd(p.monthlyRebateCents)} a month for ${p.termMonths} months, credited every 3 months (${p.installments} credits)` : <>{p.installments} instalments of {formatUsd(p.perQuarterCents)} over {short ? `${p.installments * p.intervalDays} days` : `${p.termMonths} months`}</>}</p>
          <RebateRail p={p} />
        </div>

        <ul className="space-y-1.5 text-xs text-text-2">
          <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-success" aria-hidden="true" /> EA for MetaTrader 5 and 4 with a signed licence</li>
          <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-success" aria-hidden="true" /> Contract PDF and step-by-step setup guide</li>
          <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-success" aria-hidden="true" /> Rebate paid in USDT after a short hold</li>
        </ul>

        <div className="mt-auto space-y-3">
          {slot && slot.opened ? (
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-text-3">Slots this month</span>
                <span className="font-medium text-text-2">{slot.remaining} of {slot.limit} left</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-border" role="img" aria-label={`${used} of ${slot.limit} slots taken`}>
                <div className="h-full rounded-full" style={{ width: `${slot.limit ? (used / slot.limit) * 100 : 0}%`, background: color }} />
              </div>
            </div>
          ) : (
            <p className="text-xs text-text-3">Slots open each month, set by AT24.</p>
          )}
          <BuyContract productKey={p.key} productName={p.name} blockedReason={p.blockedReason} />
        </div>
      </div>
    </Card>
  );
}

// ---------- my contracts ----------
function statusIcon(status: string) {
  if (status === "RELEASED" || status === "PAID") return <CheckCircle2 size={16} className="text-success" aria-hidden="true" />;
  if (status === "FROZEN") return <PauseCircle size={16} className="text-warning" aria-hidden="true" />;
  if (status === "CANCELLED") return <Circle size={16} className="text-text-3" aria-hidden="true" />;
  return <Clock size={16} className="text-text-3" aria-hidden="true" />;
}

function MyContract({ c, nowIso }: { c: ContractVM; nowIso: string }) {
  const color = BADGE_TIERS[c.productKey].color;
  const start = new Date(c.startsAt).getTime(), end = new Date(c.endsAt).getTime(), now = new Date(nowIso).getTime();
  const pct = end > start ? Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100)) : 0;
  const next = c.installments.find((i) => i.status === "SCHEDULED" || i.status === "FROZEN");
  const received = c.installments.filter((i) => i.status === "RELEASED" || i.status === "PAID").reduce((s, i) => s + i.amountCents, 0);
  const tone = c.status === "ACTIVE" ? "success" : c.status === "FROZEN" || c.status === "PENDING_DOCUMENT" ? "warning" : "neutral";
  const label = c.status === "PENDING_DOCUMENT" ? "Preparing documents" : c.status.toLowerCase();
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="h-1.5" style={{ background: color }} aria-hidden="true" />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-text">{c.productName}</h3>
              <Badge tone={tone}>{label}</Badge>
            </div>
            <p className="text-xs text-text-3">{dayMonth(c.startsAt)} to {dayMonth(c.endsAt)} · Price {formatUsd(c.listPriceCents)} · Net {formatUsd(c.netPriceCents)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/dashboard/licenses" variant="secondary" size="sm"><Download size={14} className="mr-1.5" aria-hidden="true" />Product and key</ButtonLink>
            {c.documentReady && (
              <ButtonLink href={`/api/private/rewards/contracts/${c.id}/document`} variant="secondary" size="sm"><FileText size={14} className="mr-1.5" aria-hidden="true" />Contract PDF</ButtonLink>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1 flex justify-between text-xs text-text-3">
            <span>Term</span>
            <span>{Math.round(pct)}% elapsed</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-card border border-border p-3">
            <p className="text-xs text-text-3">Rebate received</p>
            <p className="text-lg font-semibold text-text">{formatUsd(received)}</p>
            <p className="text-[11px] text-text-3">of {formatUsd(c.rebateTotalCents)}</p>
          </div>
          <div className="rounded-card border border-border p-3 sm:col-span-2">
            <p className="text-xs text-text-3">Next instalment</p>
            {next ? (
              <p className="text-lg font-semibold text-text">{formatUsd(next.amountCents)} <span className="text-sm font-normal text-text-3">on {dayMonth(next.dueAt)}</span>{next.status === "FROZEN" && <span className="ml-2 text-xs font-normal text-warning">paused, kept for you</span>}</p>
            ) : (
              <p className="text-sm text-text-2">All instalments are done.</p>
            )}
          </div>
        </div>

        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {c.installments.map((i) => (
            <li key={i.seq} className="flex items-center gap-2 rounded-card border border-border px-3 py-2">
              {statusIcon(i.status)}
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">{formatUsd(i.amountCents)}</p>
                <p className="truncate text-[11px] text-text-3">{monthYear(i.dueAt)} · {i.status.toLowerCase()}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

// ---------- referral earnings ----------
function ReferralEarnings({ vm }: { vm: AlgoContractsVM }) {
  const multi = vm.referral.multiLevel;
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2"><Users size={18} className="text-gold" aria-hidden="true" /><h3 className="text-base font-semibold text-text">What you earn per sale</h3></div>
      <p className="text-xs text-text-3">Fixed amounts, shown before anyone buys. {vm.referral.commissionHoldDays === 0 ? "Credited as soon as the buyer's payment is confirmed." : `Credited ${vm.referral.commissionHoldDays} days after the buyer's payment is confirmed.`}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-3">
              <th className="py-2 pr-3 font-medium">Contract</th>
              <th className="py-2 pr-3 font-medium">Direct sale</th>
              {multi && <th className="py-2 font-medium">Team sale (levels 2 to 4)</th>}
            </tr>
          </thead>
          <tbody>
            {vm.products.map((p) => (
              <tr key={p.key} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-3 text-text">{p.name}</td>
                <td className="py-2 pr-3 font-medium text-text">{formatUsd(p.referralDirectCents)}</td>
                {multi && <td className="py-2 text-text-2">{p.referralUpperCents.map((c) => formatUsd(c)).join(" / ")}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {vm.referral.allProducts && (
        <div className="space-y-1 border-t border-border pt-3">
          <p className="text-sm font-medium text-text">Every other purchase</p>
          <p className="text-xs text-text-3">
            Any product or Pro payment (every renewal) by someone you brought: <span className="text-text">2%</span> of the price paid on a direct sale
            {multi ? ", and 1% on each of levels 2 to 4" : ""}. Rounded down to the cent. {vm.referral.commissionHoldDays === 0 ? "Credited as soon as the payment is confirmed." : `Credited ${vm.referral.commissionHoldDays} days after the payment is confirmed.`}
          </p>
        </div>
      )}
    </Card>
  );
}

// ---------- page ----------
export default function AlgoContractsView({ vm }: { vm: AlgoContractsVM }) {
  const hasMoney = vm.contracts.length > 0 || vm.balances.available + vm.balances.holding + vm.balances.frozen + vm.balances.paid > 0;
  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Pro members"
        title="Algo Contracts"
        description="AI Algo contracts for Pro members. The product, a signed licence and a fixed rebate credited every 3 months on the price you pay."
        action={<ButtonLink href="/dashboard/algo-contracts/guide" variant="secondary" size="sm">User guide <ArrowRight size={14} className="ml-1.5" aria-hidden="true" /></ButtonLink>}
      />

      <StatusStrip vm={vm} />

      <section id="choose-contract" className="scroll-mt-24 space-y-3">
        <SectionTitle icon={Gem} title="Choose your contract" hint="Price, rebate and net price are fixed in your contract" />
        <div className="grid gap-5 lg:grid-cols-3">
          {vm.products.map((p) => <ContractCard key={p.key} p={p} />)}
        </div>
      </section>

      <HowItWorks hasMoney={hasMoney} />

      <section id="your-contracts" className="scroll-mt-24 space-y-3">
        <SectionTitle icon={FileText} title="Your contracts" />
        {vm.contracts.length === 0 ? (
          <EmptyState title="No contracts yet" description="After purchase your contract, product download and rebate schedule appear here." />
        ) : (
          <div className="space-y-4">{vm.contracts.map((c) => <MyContract key={c.id} c={c} nowIso={vm.nowIso} />)}</div>
        )}
      </section>

      {hasMoney && (
        <section id="balance" className="scroll-mt-24 space-y-3">
          <SectionTitle icon={Wallet} title="Balance and withdrawals" />
          <WithdrawCard
            balances={vm.balances}
            payouts={vm.payouts}
            minCents={vm.withdrawals.minCents}
            holdDays={vm.withdrawals.holdDays}
            withdrawalsOpen={vm.withdrawals.open}
            blockedReason={vm.withdrawals.blockedReason}
            address={vm.withdrawals.address}
          />
        </section>
      )}

      <section className="space-y-3">
        <SectionTitle icon={Users} title="Refer and earn" />
        <div className="grid gap-5 lg:grid-cols-2">
          <ReferralCard initialLink={vm.referral.link} blockedReason={vm.referral.blockedReason} allProducts={vm.referral.allProducts} />
          <ReferralEarnings vm={vm} />
        </div>
      </section>

      <Card className="space-y-2">
        <h2 className="text-sm font-semibold text-text">Good to know</h2>
        <ul className="list-disc space-y-1 pl-5 text-xs text-text-2">
          <li>If your Pro plan or identity check lapses, instalments are paused and kept for you, not removed. They are credited once both are back.</li>
          <li>Sales are final once your licence is issued, with the exceptions in the <a className="underline" href="/company/refund-policy">refund policy</a>.</li>
          <li>The product is software. We make no promise about trading results, and trading involves a risk of loss.</li>
        </ul>
      </Card>
    </div>
  );
}
