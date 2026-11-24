// scripts/validate-tools-calculators.ts
// Checks the arithmetic of the free public calculators against hand-computed values and the invalid-input rules.
// Run: npx tsx scripts/validate-tools-calculators.ts
import { getInstrument, losingStreak, pipValuePerLotUsd, positionSize, recoveryGainPct, riskReward } from "../lib/tools/calculators";

let failures = 0;
function ok(cond: boolean, msg: string) { if (!cond) { failures++; console.log("FAIL:", msg); } }
const near = (a: number | undefined | null, b: number, eps = 1e-6) => a !== undefined && a !== null && Math.abs(a - b) <= eps;

// pip value per standard lot
ok(near(pipValuePerLotUsd(getInstrument("EURUSD")!, null), 10), "EURUSD pip value is $10");
ok(near(pipValuePerLotUsd(getInstrument("XAUUSD")!, null), 10), "Gold pip (0.1) per lot is $10");
ok(near(pipValuePerLotUsd(getInstrument("USDJPY")!, 150), 1000 / 150), "USDJPY at 150: 1000 JPY / 150");
ok(pipValuePerLotUsd(getInstrument("USDJPY")!, null) === null, "USDJPY needs a price");
ok(pipValuePerLotUsd(getInstrument("USDJPY")!, 0) === null, "price 0 is invalid");
ok(near(pipValuePerLotUsd(getInstrument("USDCHF")!, 0.9), 10 / 0.9), "USDCHF at 0.9");

// position size: $10,000, 1% risk = $100, 20-pip stop, $10/pip -> 0.5 lot
const a = positionSize({ balance: 10000, riskPct: 1, stopPips: 20, pipValuePerLot: 10 });
ok(!!a && near(a.riskAmount, 100) && near(a.lots, 0.5) && near(a.lotsRounded, 0.5) && near(a.riskAtRounded, 100), "position size 0.5 lot");
// rounding goes DOWN: risk $100, stop 30 pips -> 0.3333 lot -> 0.33
const b = positionSize({ balance: 10000, riskPct: 1, stopPips: 30, pipValuePerLot: 10 });
ok(!!b && near(b.lotsRounded, 0.33) && b.riskAtRounded <= b.riskAmount, "rounds down, risk never above the limit");
ok(positionSize({ balance: 0, riskPct: 1, stopPips: 20, pipValuePerLot: 10 }) === null, "balance 0 invalid");
ok(positionSize({ balance: 1000, riskPct: 0, stopPips: 20, pipValuePerLot: 10 }) === null, "risk 0 invalid");
ok(positionSize({ balance: 1000, riskPct: 101, stopPips: 20, pipValuePerLot: 10 }) === null, "risk above 100 invalid");
ok(positionSize({ balance: 1000, riskPct: 1, stopPips: -5, pipValuePerLot: 10 }) === null, "negative stop invalid");
ok(positionSize({ balance: NaN, riskPct: 1, stopPips: 5, pipValuePerLot: 10 }) === null, "NaN invalid");

// risk / reward
const l = riskReward({ entry: 100, stop: 90, target: 130 });
ok(!!l && l.direction === "long" && near(l.rr, 3) && near(l.breakevenWinPct, 25), "long 1:3 breakeven 25%");
const s = riskReward({ entry: 100, stop: 110, target: 80 });
ok(!!s && s.direction === "short" && near(s.rr, 2) && near(s.breakevenWinPct, (10 / 30) * 100), "short 1:2");
ok(riskReward({ entry: 100, stop: 110, target: 120 }) === null, "stop and target on the same side invalid");
ok(riskReward({ entry: 100, stop: 100, target: 120 }) === null, "stop equal to entry invalid");

// drawdown recovery
ok(near(recoveryGainPct(50), 100), "50% loss needs +100%");
ok(near(recoveryGainPct(10), 11.111111, 1e-5), "10% loss needs +11.11%");
ok(recoveryGainPct(100) === null && recoveryGainPct(0) === null && recoveryGainPct(-5) === null, "0, 100 and negative invalid");

// losing streak
const rows = losingStreak(10000, 2, 5);
ok(!!rows && rows.length === 5 && near(rows[0].balance, 9800) && near(rows[1].balance, 9604), "losing streak balances 9800, 9604");
ok(!!rows && near(rows[4].gainNeededPct, (1 / 0.98 ** 5 - 1) * 100, 1e-6), "gain needed after 5 losses");
ok(losingStreak(10000, 100) === null, "risk 100 invalid");

console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
