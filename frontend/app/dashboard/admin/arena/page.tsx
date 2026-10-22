"use client";
// app/dashboard/admin/arena/page.tsx
// AT24 Arena Crypto Bot (admin only): the paper-trading arena where six Claude agents, a plain rules strategy and a coin flip trade the same market with
// the same risk rules. The bot runs on the owner's VPS and pushes a snapshot every cycle; this page only DISPLAYS it (no keys, no orders, nothing mocked).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Alert from "@/components/ui/Alert";

interface Stats { equity: number; return_pct: number; max_dd_pct: number; trades: number; win_pct: number | null; profit_factor: number | null; open: number; day_pnl: number; halted: boolean; avg_r: number | null }
interface Arm { stats: Stats; equity: [string, number][] }
interface Agent { name: string; text: string; level?: string; ts: string | null }
interface Activity { ts: string; agent: string; arm: string; level: string; text: string }
interface Radar { symbol: string; rel_volume: number | null; chg24: number | null; breakout: boolean; trend_ok: boolean; bullish: boolean; liquid: boolean }
interface Position { symbol: string; entry: number; price: number | null; pnl_pct: number; stop: number; qty: number }
interface Trade { symbol: string; reason: string; pnl: number; r: number; closed: string }
interface Snapshot {
  last_bar: string | null;
  regime: { breadth_above_ema200_pct?: number; btc_24h_pct?: number; btc_7d_pct?: number };
  llm: { spent_today_usd?: number; budget_usd?: number; calls?: number; failed?: number };
  arms: Record<string, Arm>;
  agents: Agent[];
  positions: Position[];
  trades: Trade[];
  activity: Activity[];
  lessons: { symbol: string; cause: string; lesson: string }[];
  radar: Radar[];
  ticker: { symbol: string; price: number; chg24: number | null }[];
}
interface Live {
  ts: string;
  prices: Record<string, number>;
  chg24: Record<string, number>;
  rel_live: Record<string, number>;
  arms: Record<string, { equity: number; return_pct: number; day_pnl: number; open: number }>;
  positions: { symbol: string; price: number; pnl_pct: number }[];
}
interface Payload { snapshot: Snapshot | null; receivedAt?: string; ageSeconds?: number; live?: Live | null; liveAgeSeconds?: number | null; configured: boolean }

// The hourly snapshot carries the decisions; the 15-second live tick carries prices, marks and rolling volume. Show the freshest of both.
function merge(snap: Snapshot | null, live: Live | null | undefined, liveOk: boolean): Snapshot | null {
  if (!snap || !live || !liveOk) return snap;
  const arms: Record<string, Arm> = {};
  for (const k of Object.keys(snap.arms)) {
    const l = live.arms[k];
    arms[k] = l ? { ...snap.arms[k], stats: { ...snap.arms[k].stats, equity: l.equity, return_pct: l.return_pct, day_pnl: l.day_pnl, open: l.open } } : snap.arms[k];
  }
  const pos = new Map(live.positions.map((p) => [p.symbol, p]));
  const main = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "LINKUSDT", "AVAXUSDT"];
  return {
    ...snap,
    arms,
    positions: snap.positions.map((p) => (pos.has(p.symbol) ? { ...p, price: pos.get(p.symbol)!.price, pnl_pct: pos.get(p.symbol)!.pnl_pct } : p)),
    radar: snap.radar.map((r) => ({ ...r, rel_volume: live.rel_live[r.symbol] ?? r.rel_volume, chg24: live.chg24[r.symbol] ?? r.chg24 })),
    ticker: main.filter((s) => live.prices[s] != null).map((s) => ({ symbol: s, price: live.prices[s], chg24: live.chg24[s] ?? null })),
  };
}

const AGENTS = ["scout", "risk_checker", "sentiment", "strategy", "execution", "risk_manager", "reviewer"];
const LABEL: Record<string, string> = { scout: "SCOUT", risk_checker: "RISK CHK", sentiment: "SENTIMENT", strategy: "STRATEGY", execution: "EXECUTION", risk_manager: "RISK MGR", reviewer: "REVIEWER" };
const ARM_NAME: Record<string, string> = { desk: "Claude desk", rules: "Rules only", random: "Random entries" };
const ARM_COLOR: Record<string, string> = { desk: "#22f08a", rules: "#7c8cff", random: "#8a93a6" };

const fmt = (n: number | null | undefined, d = 2) => (n == null ? "-" : Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
const tone = (n: number) => (n > 0 ? "text-emerald-400" : n < 0 ? "text-rose-400" : "text-[#9bb6cf]");

function moveColor(v: number): string {
  const a = Math.min(1, 0.35 + Math.abs(v) / 6);
  return v >= 0 ? `rgba(34,240,138,${a})` : `rgba(255,77,109,${a})`;
}

function drawEquity(c: HTMLCanvasElement, arms: Record<string, Arm>) {
  const dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
  c.width = W * dpr; c.height = H * dpr;
  const x = c.getContext("2d");
  if (!x) return;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, W, H);
  const series: Record<string, number[]> = {};
  const all: number[] = [];
  for (const k of Object.keys(arms)) {
    const e = arms[k].equity;
    if (!e.length) continue;
    series[k] = e.map((p) => (p[1] / e[0][1]) * 100 - 100);
    all.push(...series[k]);
  }
  if (!all.length) { x.fillStyle = "#7d8aa5"; x.fillText("waiting for the first cycles...", 16, 24); return; }
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  if (hi - lo < 1) { hi += 0.5; lo -= 0.5; }
  const pad = 24, iy = (v: number) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
  x.strokeStyle = "#ffffff14"; x.fillStyle = "#7d8aa5"; x.font = "10px monospace";
  for (let i = 0; i <= 4; i++) { const v = lo + ((hi - lo) * i) / 4, y = iy(v); x.beginPath(); x.moveTo(44, y); x.lineTo(W, y); x.stroke(); x.fillText(v.toFixed(1) + "%", 2, y + 3); }
  x.strokeStyle = "#ffffff30"; x.setLineDash([4, 4]); x.beginPath(); x.moveTo(44, iy(0)); x.lineTo(W, iy(0)); x.stroke(); x.setLineDash([]);
  for (const k of ["random", "rules", "desk"]) {
    const s = series[k];
    if (!s || !s.length) continue;
    x.strokeStyle = ARM_COLOR[k]; x.lineWidth = k === "desk" ? 2.2 : 1.4; x.beginPath();
    s.forEach((v, i) => { const px = 44 + (W - 52) * (s.length === 1 ? 1 : i / (s.length - 1)), py = iy(v); if (i) x.lineTo(px, py); else x.moveTo(px, py); });
    x.stroke();
  }
}

export default function AdminArenaPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const [fetchedAt, setFetchedAt] = useState(0);
  const [nowMs, setNowMs] = useState(0);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const orbRef = useRef<HTMLCanvasElement>(null);
  const snapRef = useRef<Snapshot | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/private/admin/arena", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      setData(body.data as Payload);
      setFetchedAt(Date.now());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => {
      setClock(new Date().toISOString().slice(11, 19));
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const liveAge = data?.liveAgeSeconds != null && fetchedAt ? data.liveAgeSeconds + Math.max(0, Math.round((nowMs - fetchedAt) / 1000)) : null;
  const liveOk = liveAge != null && liveAge < 90;
  const snap = useMemo(() => merge(data?.snapshot ?? null, data?.live, liveOk), [data, liveOk]);
  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);
  useEffect(() => {
    if (chartRef.current && snap) drawEquity(chartRef.current, snap.arms);
  }, [snap]);

  // animated agent network: coins on the outer ring, agents on the inner ring; glow = how recently an agent acted (real timestamps)
  useEffect(() => {
    const c = orbRef.current;
    if (!c) return;
    let raf = 0, T = 0;
    const parts: { x1: number; y1: number; x2: number; y2: number; t: number; c: string }[] = [];
    const frame = () => {
      const s = snapRef.current;
      const dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
      if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
      const x = c.getContext("2d");
      if (!x) return;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.fillStyle = "#050912"; x.fillRect(0, 0, W, H);
      T += 0.016;
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.43, r2 = R * 0.5;
      const g = x.createRadialGradient(cx, cy, 5, cx, cy, R); g.addColorStop(0, "#16305a55"); g.addColorStop(1, "#00000000");
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, R * 1.05, 0, 7); x.fill();
      x.strokeStyle = "#17304a"; x.lineWidth = 1;
      [R, r2, r2 * 0.45].forEach((r) => { x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke(); });
      const agents = AGENTS.map((n, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / AGENTS.length; return { n, x: cx + Math.cos(a) * r2, y: cy + Math.sin(a) * r2 }; });
      const act = Object.fromEntries((s?.agents ?? []).map((a) => [a.name, a]));
      const coins = s?.radar ?? [];
      const N = coins.length || 1;
      const pts = coins.map((r, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / N;
        return { s: r.symbol.replace("USDT", ""), v: r.rel_volume ?? 0, c: r.chg24 ?? 0, hot: (r.rel_volume ?? 0) >= 1.3 && r.bullish, bo: r.breakout, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R };
      });
      pts.forEach((p) => {
        if (p.hot) {
          x.strokeStyle = "rgba(49,212,255,.35)"; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(agents[0].x, agents[0].y); x.stroke();
          if (Math.random() < 0.04) parts.push({ x1: p.x, y1: p.y, x2: agents[0].x, y2: agents[0].y, t: 0, c: "#31d4ff" });
        }
      });
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i], b = agents[(i + 1) % agents.length];
        x.strokeStyle = "#1f4466"; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
        x.strokeStyle = "#1f446655"; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(cx, cy); x.stroke();
      }
      const last = s?.activity?.[0];
      if (last && Date.now() - new Date(last.ts).getTime() < 3600e3 && Math.random() < 0.05) {
        const i = Math.floor(Math.random() * 5);
        parts.push({ x1: agents[i].x, y1: agents[i].y, x2: agents[i + 1].x, y2: agents[i + 1].y, t: 0, c: "#a78bfa" });
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.t += 0.02;
        if (p.t >= 1) { parts.splice(i, 1); continue; }
        x.fillStyle = p.c; x.shadowColor = p.c; x.shadowBlur = 8;
        x.beginPath(); x.arc(p.x1 + (p.x2 - p.x1) * p.t, p.y1 + (p.y2 - p.y1) * p.t, 2.2, 0, 7); x.fill(); x.shadowBlur = 0;
      }
      pts.forEach((p) => {
        const rr = 3 + Math.min(9, p.v * 1.8);
        x.fillStyle = moveColor(p.c); x.shadowColor = p.hot ? "#31d4ff" : "transparent"; x.shadowBlur = p.hot ? 14 : 0;
        x.beginPath(); x.arc(p.x, p.y, rr, 0, 7); x.fill(); x.shadowBlur = 0;
        if (p.bo) { x.strokeStyle = "#f6c744"; x.lineWidth = 1.5; x.beginPath(); x.arc(p.x, p.y, rr + 3, 0, 7); x.stroke(); }
        x.fillStyle = "#8fb0cc"; x.font = "9px monospace";
        const ang = Math.atan2(p.y - cy, p.x - cx);
        x.textAlign = Math.cos(ang) > 0 ? "left" : "right";
        x.fillText(p.s, p.x + Math.cos(ang) * (rr + 5), p.y + Math.sin(ang) * (rr + 5) + 3);
      });
      agents.forEach((a) => {
        const st = act[a.n], age = st?.ts ? (Date.now() - new Date(st.ts).getTime()) / 60000 : 1e9, glow = Math.max(0, 1 - age / 90);
        const cc = st?.level === "bad" ? "#ff4d6d" : st?.level === "good" ? "#22f08a" : st?.level === "warn" ? "#f6c744" : "#a78bfa";
        x.fillStyle = "#0b1424"; x.strokeStyle = cc; x.lineWidth = 1 + glow * 2; x.shadowColor = cc; x.shadowBlur = glow * 18;
        x.beginPath(); x.arc(a.x, a.y, 15, 0, 7); x.fill(); x.stroke(); x.shadowBlur = 0;
        x.fillStyle = "#cfe3f5"; x.font = "bold 8px monospace"; x.textAlign = "center"; x.fillText(LABEL[a.n], a.x, a.y + 3);
      });
      x.fillStyle = "#0b1424"; x.strokeStyle = "#f6c744"; x.lineWidth = 2; x.shadowColor = "#f6c744"; x.shadowBlur = 14 + Math.sin(T * 2) * 1.5;
      x.beginPath(); x.arc(cx, cy, 22, 0, 7); x.fill(); x.stroke(); x.shadowBlur = 0;
      x.fillStyle = "#f6c744"; x.font = "bold 9px monospace"; x.textAlign = "center"; x.fillText("RISK", cx, cy - 1); x.fillText("ENGINE", cx, cy + 9);
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, []);

  const desk = snap?.arms?.desk?.stats;
  const stale = data?.ageSeconds != null && data.ageSeconds > 2 * 3600 + 600;
  const panel = "rounded-lg border border-[#17304a] bg-gradient-to-b from-[#0b1424] to-[#070d19] p-3";
  const head = "mb-2 text-[10px] font-bold tracking-[0.22em] text-[#31d4ff]";
  const gauge = (label: string, value: number, max: number, text: string) => {
    const r = value / max;
    return (
      <div className="my-2" key={label}>
        <div className="flex justify-between"><span>{label}</span><b>{text}</b></div>
        <div className="mt-1 h-[7px] overflow-hidden rounded bg-[#12233a]"><i className="block h-full" style={{ width: `${Math.min(100, r * 100)}%`, background: r > 0.7 ? "#ff4d6d" : r > 0.4 ? "#f6c744" : "#22f08a" }} /></div>
      </div>
    );
  };
  const btc = snap?.ticker.find((t) => t.symbol === "BTCUSDT");
  const dd = desk ? Math.abs(Math.min(0, desk.max_dd_pct)) : 0;
  const lossToday = desk ? Math.max(0, (-desk.day_pnl / desk.equity) * 100) : 0;
  const exposure = desk && snap ? (snap.positions.reduce((x, p) => x + p.qty * (p.price ?? p.entry), 0) / desk.equity) * 100 : 0;

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {data && !data.configured && <Alert tone="warning">ARENA_INGEST_SECRET is not set on the website yet, so the VPS cannot send results.</Alert>}
      {data && data.configured && !snap && <Alert tone="info">Waiting for the first snapshot from the VPS bot (it is pushed after every hourly cycle).</Alert>}
      {stale && <Alert tone="warning">The last snapshot is {Math.round((data?.ageSeconds ?? 0) / 3600)} h old - check that the VPS bot is still running.</Alert>}

      <div className="rounded-xl border border-[#17304a] bg-[#05070d] p-2 font-mono text-[12px] text-[#cfe3f5]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-[#17304a] px-3 py-2">
          <b className="tracking-[0.2em] text-[#f6c744]">AT24 // ARENA CRYPTO BOT</b>
          <span className="rounded-full border border-[#f6c74466] px-2 py-0.5 text-[10px] text-[#f6c744]">PAPER &middot; REAL DATA &middot; NO REAL MONEY</span>
          <span className={`flex items-center gap-1 ${liveOk ? "text-emerald-400" : "text-amber-400"}`}><i className="inline-block h-2 w-2 rounded-full" style={{ background: liveOk ? "#22f08a" : "#f6c744", boxShadow: liveOk ? "0 0 8px #22f08a" : "none" }} />{liveOk ? `LIVE \u00b7 ${liveAge}s ago` : liveAge != null ? `LIVE FEED STALE \u00b7 ${Math.round(liveAge / 60)} min` : "waiting for live feed"}</span>
          <span className="text-[#5d7a96]">UTC <b className="text-[#cfe3f5]">{clock}</b></span>
          <span className="text-[#5d7a96]">LAST CANDLE <b className="text-[#cfe3f5]">{(snap?.last_bar ?? "-").slice(5, 16).replace("T", " ")}</b></span>
          <span className="text-[#5d7a96]">BTC <b className="text-[#cfe3f5]">{btc ? fmt(btc.price, 0) : "-"}</b> {btc && <span className={tone(btc.chg24 ?? 0)}>{fmt(btc.chg24, 1)}%</span>}</span>
          {snap && <span className="text-[#5d7a96]">MARKET breadth {fmt(snap.regime.breadth_above_ema200_pct, 0)}% above EMA200 | BTC 7d {fmt(snap.regime.btc_7d_pct, 1)}%</span>}
          {data?.receivedAt && <span className="ml-auto text-[#5d7a96]">decisions updated {new Date(data.receivedAt).toLocaleTimeString()}</span>}
        </div>

        <div className="grid gap-2 p-2 xl:grid-cols-[300px_1fr_310px]">
          <div className={panel}>
            <p className={head}>ARMS &mdash; SAME MARKET, SAME RULES</p>
            {snap && desk ? (
              <>
                <div className="flex items-baseline justify-between"><span>CLAUDE DESK</span><span className={`text-2xl font-extrabold ${tone(desk.return_pct)}`}>{desk.return_pct >= 0 ? "+" : ""}{fmt(desk.return_pct)}%</span></div>
                <div className="text-[#5d7a96]">equity {fmt(desk.equity)} | max DD {fmt(desk.max_dd_pct)}% | win {desk.win_pct == null ? "-" : fmt(desk.win_pct, 0) + "%"} | PF {desk.profit_factor == null ? "-" : fmt(desk.profit_factor)} | {desk.trades} trades</div>
                {(["rules", "random"] as const).map((k) => (
                  <div key={k} className="mt-1 flex justify-between"><span>{ARM_NAME[k].toUpperCase()}</span><b className={tone(snap.arms[k].stats.return_pct)}>{snap.arms[k].stats.return_pct >= 0 ? "+" : ""}{fmt(snap.arms[k].stats.return_pct)}% <span className="text-[10px] font-normal text-[#5d7a96]">({snap.arms[k].stats.trades} trades)</span></b></div>
                ))}
                <p className={`${head} mt-4`}>RISK GAUGES</p>
                {gauge("Drawdown vs 20% halt", dd, 20, `${fmt(dd, 1)}% / 20%`)}
                {gauge("Day P&L vs -5% stop", lossToday, 5, `${fmt(lossToday, 1)}% / 5%`)}
                {gauge("Exposure", exposure, 100, `${fmt(exposure, 0)}% of equity`)}
                {gauge("Claude budget today", snap.llm.spent_today_usd ?? 0, snap.llm.budget_usd || 1, `$${fmt(snap.llm.spent_today_usd, 3)} / $${fmt(snap.llm.budget_usd, 0)}`)}
                <p className={`${head} mt-4`}>OPEN POSITIONS</p>
                {snap.positions.length === 0 ? <p className="text-[#5d7a96]">flat</p> : snap.positions.map((p) => (
                  <div key={p.symbol} className="flex justify-between"><span>{p.symbol}</span><span className={tone(p.pnl_pct)}>{fmt(p.pnl_pct)}%</span></div>
                ))}
              </>
            ) : <p className="text-[#5d7a96]">waiting for data...</p>}
          </div>

          <div className={`${panel} relative min-h-[520px] p-0`}>
            <p className={`${head} absolute left-3 top-3 z-10`}>AGENT NETWORK &mdash; coins in, decisions out</p>
            <canvas ref={orbRef} className="h-full min-h-[520px] w-full rounded-lg" />
            <p className="pointer-events-none absolute bottom-2 left-3 right-3 text-[10px] text-[#5d7a96]">Outer ring = the 30 coins (size = relative volume, colour = 24h move). Inner ring = the 6 agents + Reviewer; they glow when they last acted. Particles flow only along real candidate &rarr; decision paths.</p>
          </div>

          <div className={panel}>
            <p className={head}>SYMBOL RADAR &mdash; relative volume</p>
            <div className="grid grid-cols-6 gap-[3px] text-center text-[9.5px]">
              {[...(snap?.radar ?? [])].sort((a, b) => (b.rel_volume ?? 0) - (a.rel_volume ?? 0)).map((r) => (
                <div key={r.symbol} className={`rounded border px-0.5 py-1 ${r.breakout ? "border-[#f6c744]" : "border-white/10"}`} style={{ background: r.liquid ? moveColor(r.chg24 ?? 0).replace(/[\d.]+\)$/, ".18)") : "#ffffff05" }} title={`rel vol ${r.rel_volume}, 24h ${r.chg24}%`}>
                  <b>{r.symbol.replace("USDT", "")}</b><br />x{fmt(r.rel_volume, 1)}
                </div>
              ))}
            </div>
            <p className={`${head} mt-3`}>DECISION FEED</p>
            <div className="h-[230px] overflow-auto">
              {(snap?.activity ?? []).slice(0, 40).map((a, i) => (
                <div key={i} className={`border-b border-white/5 py-0.5 ${a.level === "good" ? "text-emerald-300" : a.level === "bad" ? "text-rose-300" : ""}`}>
                  <span className="text-[#5d7a96]">{a.ts.slice(11, 16)}</span> <b className="text-violet-300">{a.agent.replace("_", " ")}</b> {a.arm !== "desk" && <span className="rounded border border-white/15 px-1 text-[10px] text-[#5d7a96]">{a.arm}</span>} {a.text}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-2 p-2 sm:grid-cols-2 xl:grid-cols-7">
          {(snap?.agents ?? AGENTS.map((n) => ({ name: n, text: "idle", level: "info", ts: null }))).map((a) => (
            <div key={a.name} className={`rounded-md border p-2 ${a.level === "good" ? "border-emerald-500/40" : a.level === "bad" ? "border-rose-500/40" : a.level === "warn" ? "border-amber-500/40" : "border-[#17304a]"}`}>
              <b className="text-[10px] tracking-[0.12em]">{LABEL[a.name] ?? a.name}</b>
              <p className="mt-1 text-[10.5px] text-[#9bb6cf]">{(a.text || "idle").slice(0, 170)}</p>
            </div>
          ))}
        </div>

        {snap && (
          <div className="grid gap-2 p-2 lg:grid-cols-2">
            <div className={panel}>
              <p className={head}>EQUITY: CLAUDE DESK vs RULES vs RANDOM (return %)</p>
              <div className="mb-2 flex gap-4 text-[11px]">{Object.keys(ARM_NAME).map((k) => <span key={k}><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: ARM_COLOR[k] }} />{ARM_NAME[k]}</span>)}</div>
              <canvas ref={chartRef} className="h-60 w-full" />
            </div>
            <div className={panel}>
              <p className={head}>SCOREBOARD &mdash; does the Claude desk beat the rules and a coin flip?</p>
              <table className="w-full text-[12px]">
                <thead><tr className="text-left text-[#5d7a96]"><th>Arm</th><th className="text-right">Equity</th><th className="text-right">Return</th><th className="text-right">Trades</th><th className="text-right">Win%</th><th className="text-right">PF</th><th className="text-right">Max DD</th></tr></thead>
                <tbody>
                  {Object.keys(ARM_NAME).map((k) => {
                    const t = snap.arms[k]?.stats;
                    if (!t) return null;
                    return (
                      <tr key={k} className="border-t border-white/10">
                        <td className="py-1.5">{ARM_NAME[k]} {t.halted && <span className="text-rose-400">HALTED</span>}</td>
                        <td className="text-right">{fmt(t.equity)}</td>
                        <td className={`text-right ${tone(t.return_pct)}`}>{fmt(t.return_pct)}%</td>
                        <td className="text-right">{t.trades}</td>
                        <td className="text-right">{t.win_pct == null ? "-" : fmt(t.win_pct, 0)}</td>
                        <td className="text-right">{t.profit_factor == null ? "-" : fmt(t.profit_factor)}</td>
                        <td className="text-right text-rose-400">{fmt(t.max_dd_pct)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-[11px] text-[#5d7a96]">All three trade the same market with the same risk rules, fees and slippage. Under ~100 trades per arm proves nothing - treat early numbers as noise, and do not put real money behind the desk until it is clearly ahead of BOTH other arms for weeks.</p>
              {snap.trades.length > 0 && (
                <>
                  <p className={`${head} mt-3`}>RECENT TRADES (desk)</p>
                  {snap.trades.slice(0, 8).map((t, i) => (
                    <div key={i} className="flex justify-between text-[11.5px]"><span>{t.symbol} <span className="text-[#5d7a96]">{t.reason}</span></span><span className={tone(t.pnl)}>{t.pnl >= 0 ? "+" : ""}{fmt(t.pnl)} ({fmt(t.r)}R)</span></div>
                  ))}
                </>
              )}
              {snap.lessons.length > 0 && (
                <>
                  <p className={`${head} mt-3`}>REVIEWER LESSONS (one-sample anecdotes)</p>
                  {snap.lessons.map((l, i) => <p key={i} className="mb-1 text-[11px] text-[#9bb6cf]"><b>{l.symbol}</b> ({l.cause}) {l.lesson}</p>)}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
