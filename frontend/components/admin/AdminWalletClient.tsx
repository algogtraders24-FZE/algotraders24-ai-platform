"use client";
// components/admin/AdminWalletClient.tsx
// Admin Wallet: today's and yesterday's numbers, a day-by-day summary (money in / out, commissions, rebate credits), every withdrawal
// (members and sellers) with its address and tx reference, payments received, and referral commissions. Paying or rejecting a
// withdrawal is done here too (Mark paid with the USDT transaction reference, or Reject). The platform never sends money itself: Mark paid
// only records that you sent it. Days are India time (IST).
import { useCallback, useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";

interface Daily {
  day: string;
  depositsCents: number; depositCount: number;
  refundsCents: number; refundCount: number;
  withdrawalsRequestedCents: number; withdrawalsRequestedCount: number;
  withdrawalsPaidCents: number; withdrawalsPaidCount: number;
  commissionsCents: number; commissionCount: number;
  rebatesCents: number; rebateCount: number;
  netCents: number;
}
interface Withdrawal { kind: "Member" | "Seller"; id: string; email: string; amountCents: number; network: string; address: string; status: string; txRef: string | null; note: string | null; createdAt: string; decidedAt: string | null }
interface Deposit { id: string; at: string; email: string; amountCents: number; provider: string | null; providerRef: string | null; what: string }
interface Commission { id: string; at: string; partner: string; buyer: string | null; level: number; source: string | null; status: string; amountCents: number }
interface WalletData {
  timezone: string;
  days: string[];
  daily: Daily[];
  totals: Omit<Daily, "day">;
  open: { count: number; cents: number };
  reserve: { reserved: number; released: number; returned: number; outstanding: number; owedCents: number; shortfallCents: number; balanced: boolean };
  withdrawals: Withdrawal[];
  deposits: Deposit[];
  commissions: Commission[];
  topPartners: Array<{ partner: string; cents: number; count: number }>;
  notes: string[];
}

const usd = (c: number) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

type Tab = "daily" | "withdrawals" | "in" | "referral";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "daily", label: "Daily summary" },
  { id: "withdrawals", label: "Withdrawals" },
  { id: "in", label: "Money in" },
  { id: "referral", label: "Referral" },
];

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" }) {
  return (
    <div>
      <p className="text-xs text-text-3">{label}</p>
      <p className={`text-lg font-semibold ${tone === "bad" ? "text-danger" : "text-text"}`}>{value}</p>
      {sub && <p className="text-[11px] text-text-3">{sub}</p>}
    </div>
  );
}

function DayCard({ title, d }: { title: string; d: Daily | undefined }) {
  if (!d) return null;
  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-text">{title}</h2>
        <span className="text-xs text-text-3">{d.day}</span>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Money in" value={usd(d.depositsCents)} sub={`${d.depositCount} payments`} />
        <Stat label="Withdrawals paid" value={usd(d.withdrawalsPaidCents)} sub={`${d.withdrawalsPaidCount} paid`} />
        <Stat label="Withdrawals requested" value={usd(d.withdrawalsRequestedCents)} sub={`${d.withdrawalsRequestedCount} requests`} />
        <Stat label="Referral commission" value={usd(d.commissionsCents)} sub={`${d.commissionCount} credited`} />
        <Stat label="Rebate credited" value={usd(d.rebatesCents)} sub={`${d.rebateCount} instalments`} />
        <Stat label="Net (in - refunds - paid out)" value={usd(d.netCents)} tone={d.netCents < 0 ? "bad" : undefined} />
      </div>
    </Card>
  );
}

function csv(rows: Daily[]): string {
  const head = "day,money_in,payments,refunds,withdrawals_requested,withdrawals_paid,commissions,rebates_credited,net";
  const line = (r: Daily) => [r.day, r.depositsCents / 100, r.depositCount, r.refundsCents / 100, r.withdrawalsRequestedCents / 100, r.withdrawalsPaidCents / 100, r.commissionsCents / 100, r.rebatesCents / 100, r.netCents / 100].join(",");
  return [head, ...rows.map(line)].join("\n");
}

export default function AdminWalletClient() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<WalletData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("daily");
  const [filter, setFilter] = useState<"ALL" | "REQUESTED" | "PAID" | "REJECTED">("ALL");
  const [tx, setTx] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (n: number) => {
    setError(null);
    try {
      const res = await fetch(`/api/private/admin/wallet?days=${n}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.status !== "ok") throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
      setData(json.data as WalletData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load.");
    }
  }, []);
  useEffect(() => { void load(days); }, [load, days]);

  async function decide(w: Withdrawal, decision: "PAID" | "REJECTED") {
    setError(null);
    setNotice(null);
    let note = "";
    if (decision === "REJECTED") {
      note = window.prompt(w.kind === "Member" ? "Reason for rejecting (the amount returns to the member's balance):" : "Reason for rejecting (the earnings return to the seller):") ?? "";
      if (!note.trim()) return;
    } else if (!window.confirm(`Confirm: you already sent ${usd(w.amountCents)} USDT (${w.network}) to ${w.address} and the transaction reference is correct?`)) {
      return;
    }
    setBusy(w.id);
    try {
      const res = w.kind === "Member"
        ? await fetch("/api/private/admin/rewards/payouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payoutId: w.id, decision, txRef: tx[w.id], note }) })
        : await fetch("/api/private/admin/seller-payouts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: w.id, action: decision === "PAID" ? "paid" : "reject", txRef: tx[w.id], note }) });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.status !== "ok") throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
      setNotice(decision === "PAID" ? "Marked as paid." : "Rejected; the amount went back to the balance.");
      await load(days);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  function download() {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([csv(data.daily)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `wallet-daily-${data.days[0]}_to_${data.days[data.days.length - 1]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!data) return <div className="text-sm text-text-3">{error ?? "Loading..."}</div>;
  const today = data.daily[data.daily.length - 1];
  const yesterday = data.daily[data.daily.length - 2];
  const r = data.reserve;
  const withdrawals = data.withdrawals.filter((w) => filter === "ALL" || w.status === filter);

  return (
    <div className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-text">Position now</h2>
          <span className="text-xs text-text-3">Days are {data.timezone}</span>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Stat label="Withdrawals waiting" value={usd(data.open.cents)} sub={`${data.open.count} open requests`} tone={data.open.count > 0 ? "bad" : undefined} />
          <Stat label="Rebate reserve held" value={usd(r.outstanding)} />
          <Stat label="Still owed to members" value={usd(r.owedCents)} tone={r.balanced ? undefined : "bad"} />
          <Stat label={`Money in (${days} days)`} value={usd(data.totals.depositsCents)} sub={`${data.totals.depositCount} payments`} />
          <Stat label={`Paid out (${days} days)`} value={usd(data.totals.withdrawalsPaidCents)} sub={`${data.totals.withdrawalsPaidCount} withdrawals`} />
        </div>
        {r.balanced ? <Badge tone="success">Reserve matches what is owed</Badge> : <Alert tone="danger">Reserve does not match what is owed. Shortfall {usd(r.shortfallCents)}.</Alert>}
        {data.open.count > 0 && (
          <p className="text-xs text-text-3">
            Open requests are in the{" "}
            <button type="button" onClick={() => { setTab("withdrawals"); setFilter("REQUESTED"); }} className="text-gold underline">Withdrawals tab</button>
            : send the USDT yourself, paste the transaction reference, then Mark paid. The platform never sends money itself.
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <DayCard title="Today" d={today} />
        <DayCard title="Yesterday" d={yesterday} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 border-b border-border">
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`px-3 py-2 text-sm ${tab === t.id ? "border-b-2 border-gold font-medium text-text" : "text-text-3 hover:text-text"}`}>{t.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Days to show" value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-card border border-border bg-ink-2 px-2 py-1.5 text-sm text-text">
            {[7, 14, 30, 60, 90].map((n) => <option key={n} value={n}>Last {n} days</option>)}
          </select>
          {tab === "daily" && <Button size="sm" variant="secondary" onClick={download}>Download CSV</Button>}
        </div>
      </div>

      {tab === "daily" && (
        <Card padding="none" className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="border-b border-border text-text-3">
              <tr>
                {["Day", "Money in", "Refunds", "Requested", "Paid out", "Commission", "Rebate credited", "Net"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...data.daily].reverse().map((d) => (
                <tr key={d.day} className="border-b border-border/50">
                  <td className="px-3 py-2 text-text-2">{d.day}</td>
                  <td className="px-3 py-2 text-text">{usd(d.depositsCents)} <span className="text-text-3">({d.depositCount})</span></td>
                  <td className="px-3 py-2 text-text-2">{usd(d.refundsCents)}</td>
                  <td className="px-3 py-2 text-text-2">{usd(d.withdrawalsRequestedCents)} <span className="text-text-3">({d.withdrawalsRequestedCount})</span></td>
                  <td className="px-3 py-2 text-text-2">{usd(d.withdrawalsPaidCents)} <span className="text-text-3">({d.withdrawalsPaidCount})</span></td>
                  <td className="px-3 py-2 text-text-2">{usd(d.commissionsCents)} <span className="text-text-3">({d.commissionCount})</span></td>
                  <td className="px-3 py-2 text-text-2">{usd(d.rebatesCents)} <span className="text-text-3">({d.rebateCount})</span></td>
                  <td className={`px-3 py-2 font-medium ${d.netCents < 0 ? "text-danger" : "text-text"}`}>{usd(d.netCents)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-3 py-2 text-text">Total</td>
                <td className="px-3 py-2 text-text">{usd(data.totals.depositsCents)}</td>
                <td className="px-3 py-2 text-text">{usd(data.totals.refundsCents)}</td>
                <td className="px-3 py-2 text-text">{usd(data.totals.withdrawalsRequestedCents)}</td>
                <td className="px-3 py-2 text-text">{usd(data.totals.withdrawalsPaidCents)}</td>
                <td className="px-3 py-2 text-text">{usd(data.totals.commissionsCents)}</td>
                <td className="px-3 py-2 text-text">{usd(data.totals.rebatesCents)}</td>
                <td className="px-3 py-2 text-text">{usd(data.totals.netCents)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      )}

      {tab === "withdrawals" && (
        <div className="space-y-3">
          <div className="flex gap-1">
            {(["ALL", "REQUESTED", "PAID", "REJECTED"] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "primary" : "secondary"} onClick={() => setFilter(f)}>{f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}</Button>
            ))}
          </div>
          <Card padding="none" className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="border-b border-border text-text-3">
                <tr>{["Requested", "Type", "Who", "Amount", "Network / address", "Status", "Tx reference / action"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {withdrawals.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-text-3">Nothing here.</td></tr>}
                {withdrawals.map((w) => (
                  <tr key={`${w.kind}-${w.id}`} className="border-b border-border/50 align-top">
                    <td className="px-3 py-2 text-text-2">{when(w.createdAt)}</td>
                    <td className="px-3 py-2 text-text-2">{w.kind}</td>
                    <td className="px-3 py-2 text-text">{w.email}</td>
                    <td className="px-3 py-2 font-medium text-text">{usd(w.amountCents)}</td>
                    <td className="px-3 py-2 text-text-2"><span className="text-text-3">{w.network}</span> <span className="break-all font-mono">{w.address}</span></td>
                    <td className="px-3 py-2"><Badge tone={w.status === "PAID" ? "success" : w.status === "REJECTED" ? "danger" : "warning"}>{w.status}</Badge></td>
                    <td className="px-3 py-2 text-text-2">
                      {w.status === "REQUESTED" ? (
                        <div className="flex min-w-[260px] flex-col gap-2">
                          <Input value={tx[w.id] ?? ""} onChange={(e) => setTx({ ...tx, [w.id]: e.target.value })} placeholder="USDT transaction reference" aria-label="Transaction reference" />
                          <div className="flex gap-2">
                            <Button size="sm" disabled={busy === w.id || (tx[w.id] ?? "").trim().length < 6} onClick={() => void decide(w, "PAID")}>Mark paid</Button>
                            <Button size="sm" variant="secondary" disabled={busy === w.id} onClick={() => void decide(w, "REJECTED")}>Reject</Button>
                          </div>
                        </div>
                      ) : (
                        <span className="break-all font-mono">{w.txRef ?? "-"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === "in" && (
        <div className="space-y-3">
          <Card padding="none" className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="border-b border-border text-text-3">
                <tr>{["Paid", "Buyer", "What", "Amount", "Provider / reference"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.deposits.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-text-3">No payments in this period.</td></tr>}
                {data.deposits.map((d) => (
                  <tr key={d.id} className="border-b border-border/50">
                    <td className="px-3 py-2 text-text-2">{when(d.at)}</td>
                    <td className="px-3 py-2 text-text">{d.email}</td>
                    <td className="px-3 py-2 text-text-2">{d.what}</td>
                    <td className="px-3 py-2 font-medium text-text">{usd(d.amountCents)}</td>
                    <td className="px-3 py-2 text-text-3">{d.provider ?? "-"} <span className="break-all font-mono">{d.providerRef ?? ""}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {data.notes.map((n) => <p key={n} className="text-xs text-text-3">{n}</p>)}
        </div>
      )}

      {tab === "referral" && (
        <div className="space-y-4">
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold text-text">Top partners ({days} days)</h2>
            {data.topPartners.length === 0 ? <p className="text-sm text-text-3">No commissions in this period.</p> : (
              <ul className="space-y-1 text-sm">
                {data.topPartners.map((p) => (
                  <li key={p.partner} className="flex justify-between gap-3"><span className="text-text">{p.partner}</span><span className="text-text-2">{usd(p.cents)} <span className="text-text-3">({p.count})</span></span></li>
                ))}
              </ul>
            )}
          </Card>
          <Card padding="none" className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-xs">
              <thead className="border-b border-border text-text-3">
                <tr>{["Credited", "Partner", "Buyer", "Level", "From", "Amount", "Status"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.commissions.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-text-3">Nothing here.</td></tr>}
                {data.commissions.map((c) => (
                  <tr key={c.id} className="border-b border-border/50">
                    <td className="px-3 py-2 text-text-2">{when(c.at)}</td>
                    <td className="px-3 py-2 text-text">{c.partner}</td>
                    <td className="px-3 py-2 text-text-2">{c.buyer ?? "-"}</td>
                    <td className="px-3 py-2 text-text-2">{c.level === 0 ? "Direct" : `Level ${c.level + 1}`}</td>
                    <td className="px-3 py-2 text-text-2">{c.source ?? "-"}</td>
                    <td className="px-3 py-2 font-medium text-text">{usd(c.amountCents)}</td>
                    <td className="px-3 py-2 text-text-2">{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
