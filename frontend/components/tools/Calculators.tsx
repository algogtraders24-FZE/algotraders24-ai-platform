"use client";
// components/tools/Calculators.tsx
// The four free public calculators (no login). Pure arithmetic from lib/tools/calculators.ts; nothing is sent anywhere.
import { useMemo, useState } from "react";
import { TOOL_INSTRUMENTS, getInstrument, losingStreak, pipValuePerLotUsd, positionSize, recoveryGainPct, riskReward } from "@/lib/tools/calculators";

const PANEL = "rounded-panel border border-border bg-ink-2 p-6";
const INPUT = "mt-1 w-full rounded-lg border border-border bg-ink px-3 py-2 text-text outline-none focus:border-gold";
const LABEL = "block text-sm font-medium text-text-2";

function Num({ label, value, onChange, step, hint }: { label: string; value: string; onChange: (v: string) => void; step?: string; hint?: string }) {
  return (
    <label className={LABEL}>
      {label}
      <input className={INPUT} inputMode="decimal" type="number" step={step ?? "any"} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="mt-1 block text-xs text-text-3">{hint}</span>}
    </label>
  );
}

function Result({ rows, note }: { rows: [string, string][]; note?: string }) {
  return (
    <div className="mt-6 rounded-lg border border-border bg-ink p-4" aria-live="polite">
      <dl className="grid gap-3 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs uppercase tracking-wide text-text-3">{k}</dt>
            <dd className="mt-1 text-xl font-semibold text-gold">{v}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="mt-3 text-sm leading-6 text-text-2">{note}</p>}
    </div>
  );
}
const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const fix = (n: number, d: number) => n.toFixed(d);
const Invalid = () => <p className="mt-6 text-sm text-text-3">Enter valid positive numbers to see the result.</p>;

function InstrumentSelect({ id, onChange }: { id: string; onChange: (v: string) => void }) {
  return (
    <label className={LABEL}>
      Instrument
      <select className={INPUT} value={id} onChange={(e) => onChange(e.target.value)}>
        {TOOL_INSTRUMENTS.map((i) => (
          <option key={i.id} value={i.id}>{i.label}</option>
        ))}
      </select>
    </label>
  );
}

export function PositionSizeCalculator() {
  const [id, setId] = useState("EURUSD");
  const [balance, setBalance] = useState("10000");
  const [risk, setRisk] = useState("1");
  const [stop, setStop] = useState("20");
  const [price, setPrice] = useState("150");
  const inst = getInstrument(id)!;
  const needsPrice = inst.quote !== "USD";
  const res = useMemo(() => {
    const pv = pipValuePerLotUsd(inst, needsPrice ? Number(price) : null);
    if (pv === null) return null;
    const r = positionSize({ balance: Number(balance), riskPct: Number(risk), stopPips: Number(stop), pipValuePerLot: pv });
    return r ? { r, pv } : null;
  }, [inst, needsPrice, price, balance, risk, stop]);
  return (
    <div className={PANEL}>
      <div className="grid gap-4 sm:grid-cols-2">
        <InstrumentSelect id={id} onChange={setId} />
        <Num label="Account balance (USD)" value={balance} onChange={setBalance} />
        <Num label="Risk per trade (%)" value={risk} onChange={setRisk} hint="Many traders keep this between 0.5 and 2 percent." />
        <Num label="Stop-loss distance (pips)" value={stop} onChange={setStop} hint={id === "XAUUSD" ? "For gold, 1 pip = a 0.10 price move on most brokers." : undefined} />
        {needsPrice && <Num label={`Current ${inst.label} price`} value={price} onChange={setPrice} hint="Used to convert the pip value to USD." />}
      </div>
      {res ? (
        <Result
          rows={[
            ["Amount at risk", money(res.r.riskAmount)],
            ["Position size", `${fix(res.r.lotsRounded, 2)} lots`],
            ["Exact size", `${fix(res.r.lots, 4)} lots`],
            ["Pip value (1 lot)", money(res.pv)],
          ]}
          note={`Rounded down to the 0.01 lot step, so the real risk is ${money(res.r.riskAtRounded)}, never above your limit. Check your broker's contract size and minimum lot.`}
        />
      ) : (
        <Invalid />
      )}
    </div>
  );
}

export function PipValueCalculator() {
  const [id, setId] = useState("EURUSD");
  const [lots, setLots] = useState("1");
  const [price, setPrice] = useState("150");
  const inst = getInstrument(id)!;
  const needsPrice = inst.quote !== "USD";
  const res = useMemo(() => {
    const pv = pipValuePerLotUsd(inst, needsPrice ? Number(price) : null);
    const l = Number(lots);
    return pv !== null && Number.isFinite(l) && l > 0 ? { pv, total: pv * l } : null;
  }, [inst, needsPrice, price, lots]);
  return (
    <div className={PANEL}>
      <div className="grid gap-4 sm:grid-cols-2">
        <InstrumentSelect id={id} onChange={setId} />
        <Num label="Position size (lots)" value={lots} onChange={setLots} />
        {needsPrice && <Num label={`Current ${inst.label} price`} value={price} onChange={setPrice} hint="Used to convert the pip value to USD." />}
      </div>
      {res ? (
        <Result
          rows={[
            ["Value of 1 pip, 1 lot", money(res.pv)],
            [`Value of 1 pip, ${lots} lot(s)`, money(res.total)],
            ["Value of 10 pips", money(res.total * 10)],
            ["Value of 50 pips", money(res.total * 50)],
          ]}
          note="Pip value for an account in USD. Brokers can quote slightly different contract sizes, so confirm in your platform."
        />
      ) : (
        <Invalid />
      )}
    </div>
  );
}

export function RiskRewardCalculator() {
  const [entry, setEntry] = useState("2650");
  const [stop, setStop] = useState("2640");
  const [target, setTarget] = useState("2680");
  const res = useMemo(() => riskReward({ entry: Number(entry), stop: Number(stop), target: Number(target) }), [entry, stop, target]);
  return (
    <div className={PANEL}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Num label="Entry price" value={entry} onChange={setEntry} />
        <Num label="Stop-loss price" value={stop} onChange={setStop} />
        <Num label="Take-profit price" value={target} onChange={setTarget} />
      </div>
      {res ? (
        <Result
          rows={[
            ["Direction", res.direction === "long" ? "Long (buy)" : "Short (sell)"],
            ["Risk : reward", `1 : ${fix(res.rr, 2)}`],
            ["Distance to stop", fix(res.risk, 5).replace(/\.?0+$/, "")],
            ["Distance to target", fix(res.reward, 5).replace(/\.?0+$/, "")],
            ["Break-even win rate", `${fix(res.breakevenWinPct, 1)}%`],
          ]}
          note="Break-even win rate is plain arithmetic: the share of trades that must reach the target for the plan to break even before spread and commission. It says nothing about how often a real trade will."
        />
      ) : (
        <p className="mt-6 text-sm text-text-3">The stop and the target must be on opposite sides of the entry (stop below and target above for a long, the reverse for a short).</p>
      )}
    </div>
  );
}

export function DrawdownRecoveryCalculator() {
  const [loss, setLoss] = useState("20");
  const [balance, setBalance] = useState("10000");
  const [risk, setRisk] = useState("2");
  const gain = useMemo(() => recoveryGainPct(Number(loss)), [loss]);
  const streak = useMemo(() => losingStreak(Number(balance), Number(risk), 10), [balance, risk]);
  return (
    <div className="space-y-6">
      <div className={PANEL}>
        <h2 className="text-lg font-semibold text-text">Gain needed to recover a loss</h2>
        <div className="mt-4 max-w-xs">
          <Num label="Account drawdown (%)" value={loss} onChange={setLoss} />
        </div>
        {gain !== null ? (
          <Result rows={[["Gain needed to get back to even", `+${fix(gain, 2)}%`]]} note="Losses and gains do not cancel out: a 50 percent loss needs a 100 percent gain to recover. That is why small risk per trade matters." />
        ) : (
          <p className="mt-6 text-sm text-text-3">Enter a drawdown above 0 and below 100.</p>
        )}
      </div>
      <div className={PANEL}>
        <h2 className="text-lg font-semibold text-text">What a losing streak does to a balance</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Num label="Starting balance (USD)" value={balance} onChange={setBalance} />
          <Num label="Risk per trade (% of current balance)" value={risk} onChange={setRisk} />
        </div>
        {streak ? (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-text-3">
                <tr><th className="py-2 pr-4">Losses in a row</th><th className="py-2 pr-4">Balance</th><th className="py-2 pr-4">Down</th><th className="py-2">Gain to recover</th></tr>
              </thead>
              <tbody className="text-text-2">
                {streak.map((r) => (
                  <tr key={r.losses} className="border-t border-border">
                    <td className="py-2 pr-4">{r.losses}</td>
                    <td className="py-2 pr-4">{money(r.balance)}</td>
                    <td className="py-2 pr-4">{fix(r.lossPct, 2)}%</td>
                    <td className="py-2">+{fix(r.gainNeededPct, 2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Invalid />
        )}
      </div>
    </div>
  );
}
