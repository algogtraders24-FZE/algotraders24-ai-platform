// app/contest/[slug]/page.tsx - the demo contest: prizes, rules, how to enter, the live leaderboard (and the winners once finalized).
import Link from "next/link";
import { notFound } from "next/navigation";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import ButtonLink from "@/components/ui/ButtonLink";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/ui/Table";
import { getContest, myEntry, publicLeaderboard } from "@/services/contest/contestService";
import { readContestRules } from "@/services/contest/standings";
import EnterContestForm from "./EnterContestForm";
import ClaimOfferButton from "./ClaimOfferButton";

export const dynamic = "force-dynamic";

const day = (d: Date) => d.toISOString().slice(0, 10);
const pct = (n: number | null) => (n === null ? "-" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await getContest(slug).catch(() => null);
  return { title: c ? `${c.title} | Algotraders24 AI` : "Demo contest | Algotraders24 AI" };
}

export default async function ContestPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const contest = await getContest(slug);
  if (!contest || contest.status === "DRAFT") notFound();
  const rules = readContestRules(contest.rules);
  const rows = await publicLeaderboard(contest.id);
  const user = await getUserOrNull();
  const open = contest.status === "OPEN" && Date.now() < contest.endsAt.getTime();

  let entry: Awaited<ReturnType<typeof myEntry>> = null;
  let accounts: { id: string; label: string }[] = [];
  let hasLicence = false;
  if (user) {
    entry = await myEntry(user.profile.id, contest.id);
    const accs = await prisma.liveSyncAccount.findMany({ where: { userId: user.profile.id, mode: { not: "real" } }, orderBy: { firstSyncAt: "asc" }, select: { id: true, mode: true, currency: true, platform: true, lastSyncAt: true } });
    accounts = accs.map((a, i) => ({ id: a.id, label: `Demo account ${i + 1} (${a.currency}, ${a.platform.toUpperCase()}) - last sync ${day(a.lastSyncAt)}` }));
    hasLicence = (await prisma.license.count({ where: { buyerId: user.profile.id, tradingSystemId: contest.tradingSystemId } })) > 0;
  }
  const winners = Array.isArray(contest.winners) ? (contest.winners as { rank: number; alias: string; profitPct: number }[]) : [];
  const mine = entry ? rows.find((r) => r.alias === entry!.alias) : undefined;

  return (
    <main className="min-h-screen bg-ink pt-20 text-text">
      <Navbar />
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold">
            {contest.status === "FINALIZED" ? "Finished" : open ? "Open" : "Closed"} - {day(contest.startsAt)} to {day(contest.endsAt)}
          </p>
          <h1 className="text-3xl font-bold sm:text-4xl">{contest.title}</h1>
          <p className="text-text-2">
            Run the XXX US30 demo on your own demo account. The top 3 results win a <b className="text-text">{contest.prizeMonths}-month licence</b>, and
            everyone who takes part gets <b className="text-text">{contest.offerPercent}% off</b> the full product.
          </p>
        </header>

        {winners.length > 0 && (
          <section className="space-y-2 rounded-card border border-gold/40 bg-ink-2 p-5">
            <h2 className="text-xl font-semibold">Winners</h2>
            <ol className="space-y-1 text-sm">
              {winners.map((w) => (
                <li key={w.rank}><b className="text-gold">#{w.rank}</b> {w.alias} - {pct(w.profitPct)}</li>
              ))}
            </ol>
            <p className="text-xs text-text-3">Checked by AT24 before the prize licences were issued.</p>
          </section>
        )}

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 rounded-card border border-border bg-ink-2 p-5">
            <h2 className="text-lg font-semibold">How you are ranked</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-text-2">
              <li>Profit % of your demo account over the window, measured against your balance at the start - so a bigger lot does not buy a better rank.</li>
              <li>Only trades of the EA (its magic number) closed inside the window count.</li>
              <li>Stay inside the rules: daily loss {rules.dailyLossPct}% and max loss {rules.maxLossPct}% of the start balance. Break one and you stay on the board but are out of the prizes.</li>
              <li>At least {rules.minTradingDays} trading days and {rules.minTrades} closed trades.</li>
              <li>Ties: the smaller max loss, then more trades.</li>
            </ul>
          </div>
          <div className="space-y-3 rounded-card border border-border bg-ink-2 p-5">
            <h2 className="text-lg font-semibold">Take part</h2>
            {!user ? (
              <div className="space-y-2 text-sm text-text-2">
                <p>Create a free account, start the free demo, connect your demo to Live Sync, then enter here.</p>
                <div className="flex flex-wrap gap-2">
                  <ButtonLink href="/signup" size="sm">Create a free account</ButtonLink>
                  <ButtonLink href={`/login?redirect=/contest/${contest.slug}`} size="sm" variant="secondary">Sign in</ButtonLink>
                </div>
              </div>
            ) : entry ? (
              <div className="space-y-1 text-sm text-text-2">
                <p>You are in as <b className="text-text">{entry.alias}</b>.</p>
                {mine ? <p>Your standing: {mine.rank ? `rank #${mine.rank}` : "not ranked yet"} | {pct(mine.profitPct)} | {mine.trades} trades{mine.note ? ` | ${mine.note}` : ""}</p> : <p>Your first closed trades will appear on the board within a few minutes.</p>}
                <div className="pt-2">
                  <p className="mb-2">As a contest member you get <b className="text-text">{contest.offerPercent}% off</b> the full product:</p>
                  <ClaimOfferButton slug={contest.slug} percent={contest.offerPercent} />
                </div>
              </div>
            ) : !open ? (
              <p className="text-sm text-text-2">Entries are closed.</p>
            ) : !hasLicence ? (
              <div className="space-y-2 text-sm text-text-2">
                <p>The contest is for people running the XXX US30 demo. Start your free demo first.</p>
                <ButtonLink href="/demo" size="sm">Start the free demo</ButtonLink>
              </div>
            ) : accounts.length === 0 ? (
              <div className="space-y-2 text-sm text-text-2">
                <p>Connect your demo account to AT24 Live Sync (free) - the contest reads your results from there.</p>
                <ButtonLink href="/dashboard/live-sync" size="sm">Open Live Sync</ButtonLink>
              </div>
            ) : (
              <EnterContestForm slug={contest.slug} accounts={accounts} />
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Leaderboard</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-text-3">No entries yet - be the first.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <Thead>
                  <tr>
                    <Th>#</Th><Th>Trader</Th><Th>Profit</Th><Th>Trades</Th><Th>Days</Th><Th>Worst day</Th><Th>Max loss</Th><Th>Status</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {rows.slice(0, 100).map((r) => (
                    <Tr key={r.alias}>
                      <Td>{r.rank ?? "-"}</Td>
                      <Td>{r.alias}</Td>
                      <Td>{pct(r.profitPct)}</Td>
                      <Td>{r.trades}</Td>
                      <Td>{r.tradingDays}</Td>
                      <Td>{r.worstDailyLossPct ? `${r.worstDailyLossPct.toFixed(2)}%` : "-"}</Td>
                      <Td>{r.maxLossUsedPct ? `${r.maxLossUsedPct.toFixed(2)}%` : "-"}</Td>
                      <Td>{r.eligible ? "In the prizes" : r.note ?? "-"}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}
          <p className="text-xs text-text-3">Updated every few minutes.</p>
        </section>

        <section className="space-y-2 text-xs text-text-3">
          <p>
            Demo accounts only. Results are terminal-reported closed trades, not verified by a broker; floating losses are not counted and deposits or
            withdrawals during the window are ignored. Times are the broker&apos;s server time. AT24 checks the winners (trade history, one EA, one entry per
            person) before any prize licence is issued, and may disqualify an entry that breaks the rules. One prize per person. Free to enter.
          </p>
          <p>
            A demo is not live trading; results on a real account can be different. Past results do not predict future results. Trading leveraged products
            is risky; this is not financial advice. <Link href="/demo" className="text-gold hover:underline">About the free demo</Link>
          </p>
        </section>
      </div>
      <Footer />
    </main>
  );
}
