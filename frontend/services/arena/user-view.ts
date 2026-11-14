// services/arena/user-view.ts
// What a signed-in (non-admin) user may see of the Arena. Pure function so it can be tested; the server applies it BEFORE anything leaves the API.
// Always removed: Claude spend / budget / call counts, the Reviewer's lessons (internal), anything not needed for the picture.
// ARENA_USER_DELAY_MINUTES (default 0 = fully live): when > 0 the decision feed and closed trades are delayed by that long, and open
// positions, pending orders and the live position P&L are hidden - one switch to make the public view less "signal-like" later.

type Json = Record<string, unknown>;

export function userDelayMinutes(raw: string | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 7 * 24 * 60) : 0;
}

export function sanitizeForUsers(payload: Json | null, live: Json | null, delayMin: number, nowMs: number): { snapshot: Json | null; live: Json | null } {
  const outLive: Json | null = live ? { ...live } : null;
  if (outLive) delete outLive.account;
  if (!payload) return { snapshot: null, live: outLive };
  const p: Json = { ...payload };
  delete p.llm;
  delete p.account;        // balances / open orders of the demo account are admin-only
  delete p.demo_trades;
  p.lessons = [];
  if (delayMin > 0) {
    const cutoff = nowMs - delayMin * 60_000;
    const old = (iso: unknown) => typeof iso === "string" && new Date(iso).getTime() <= cutoff;
    p.activity = Array.isArray(p.activity) ? (p.activity as Json[]).filter((a) => old(a.ts)) : [];
    p.trades = Array.isArray(p.trades) ? (p.trades as Json[]).filter((t) => old(t.closed)) : [];
    p.positions = [];
    p.pending = [];
    p.agents = Array.isArray(p.agents) ? (p.agents as Json[]).map((a) => ({ name: a.name, ts: a.ts, text: "", level: undefined })) : [];
    if (outLive) outLive.positions = [];
  }
  return { snapshot: p, live: outLive };
}
