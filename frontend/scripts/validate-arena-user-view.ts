// scripts/validate-arena-user-view.ts
// Checks what a signed-in user may see of the Arena. Run: npx tsx --conditions=react-server scripts/validate-arena-user-view.ts
import { sanitizeForUsers, userDelayMinutes } from "../services/arena/user-view";

let passed = 0, failed = 0;
const check = (name: string, ok: boolean) => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };

const NOW = Date.parse("2026-10-23T12:00:00Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const payload = () => ({
  ready: true, llm: { spent_today_usd: 1.2, budget_usd: 3, calls: 9, failed: 1 }, lessons: [{ symbol: "BTCUSDT", lesson: "x" }],
  activity: [{ ts: iso(5), agent: "strategy", text: "BUY SOL" }, { ts: iso(3000), agent: "scout", text: "old" }],
  trades: [{ symbol: "SOLUSDT", closed: iso(10), pnl: 5 }, { symbol: "ETHUSDT", closed: iso(4000), pnl: -2 }],
  positions: [{ symbol: "SOLUSDT" }], pending: [{ symbol: "ETHUSDT" }],
  agents: [{ name: "strategy", ts: iso(5), text: "BUY SOL", level: "good" }], arms: { desk: { stats: { equity: 1 } } }, radar: [{ symbol: "BTCUSDT" }],
});
const live = () => ({ ts: "t", arms: {}, positions: [{ symbol: "SOLUSDT", pnl_pct: 1 }], prices: { BTCUSDT: 1 } });

check("delay parsing: default 0, junk -> 0, capped", userDelayMinutes(undefined) === 0 && userDelayMinutes("abc") === 0 && userDelayMinutes("-5") === 0 && userDelayMinutes("60") === 60 && userDelayMinutes("999999") === 7 * 24 * 60);

const a = sanitizeForUsers(payload(), live(), 0, NOW);
check("live mode: Claude spend/budget/calls are never sent to users", !!a.snapshot && !("llm" in a.snapshot));
check("live mode: reviewer lessons are not sent", Array.isArray(a.snapshot!.lessons) && (a.snapshot!.lessons as unknown[]).length === 0);
check("live mode: decisions, positions and trades are visible (owner choice)", (a.snapshot!.activity as unknown[]).length === 2 && (a.snapshot!.positions as unknown[]).length === 1 && (a.snapshot!.trades as unknown[]).length === 2);
check("live mode: live position P&L passes through", ((a.live as { positions: unknown[] }).positions).length === 1);

const b = sanitizeForUsers(payload(), live(), 60, NOW);
check("delayed mode: only decisions older than the delay remain", (b.snapshot!.activity as { text: string }[]).length === 1 && (b.snapshot!.activity as { text: string }[])[0].text === "old");
check("delayed mode: only trades closed before the cutoff remain", (b.snapshot!.trades as { symbol: string }[]).length === 1 && (b.snapshot!.trades as { symbol: string }[])[0].symbol === "ETHUSDT");
check("delayed mode: positions, pending orders and live position P&L are hidden", (b.snapshot!.positions as unknown[]).length === 0 && (b.snapshot!.pending as unknown[]).length === 0 && ((b.live as { positions: unknown[] }).positions).length === 0);
check("delayed mode: agent text is blanked", (b.snapshot!.agents as { text: string }[]).every((x) => x.text === ""));
check("delayed mode still never leaks llm", !("llm" in b.snapshot!));
check("the input object is not mutated", "llm" in payload() && (live() as { positions: unknown[] }).positions.length === 1);
const c = sanitizeForUsers(null, live(), 0, NOW);
check("no snapshot yet -> null snapshot, live passes through", c.snapshot === null && c.live !== null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
