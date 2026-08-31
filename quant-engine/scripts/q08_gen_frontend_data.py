"""
Q0.8 one-off data-conversion helper - temporary, isolated. Converts real,
already-computed data (strategy_library.db sample, Q0.6's verified MACD
ledger) into TypeScript source for the Quant Lite frontend. Read-only
against both source files; does not modify strategy_library.db or any
Q0.6 output.
"""
import json

def esc(s):
    return s.replace("\\", "\\\\").replace('"', '\\"')


def gen_library_ts():
    with open("quant-engine/output/library_sample.json") as f:
        lib = json.load(f)

    lines = []
    lines.append('// Real, read-only sample pulled from quant-engine/spec_engine/strategy_library.db')
    lines.append("// (Q0.2-Q0.6 legacy engine audit program). strategy_library.db itself was never")
    lines.append('// modified - this is a static snapshot for the Quant Lite UI, per Q0.7/Q0.8\'s')
    lines.append('// "read-only, no regeneration" requirement. Every metric here predates the')
    lines.append("// canonical execution_mtf.py fix (Q0.6) and the account-blown fix (Q0.2) -")
    lines.append('// hence LEGACY-BACKTEST-EVIDENCE, never "validated."')
    lines.append('import type { LibraryEntry } from "@/types/quant-lite";')
    lines.append("")
    lines.append("export const LIBRARY_SAMPLE: LibraryEntry[] = [")
    for i, row in enumerate(lib):
        spec = json.loads(row["spec_json"])
        lines.append("  {")
        lines.append(f'    id: "lib-{i + 1}",')
        lines.append(f'    name: "{esc(row["name"])}",')
        lines.append(f'    symbol: "{row["symbol"]}",')
        lines.append(f'    timeframe: "{row["timeframe"]}",')
        lines.append(f'    triggerKey: "{row["trigger_key"]}",')
        lines.append(f'    filterKey: "{row["filter_key"]}",')
        lines.append(f'    riskPreset: "{row["risk_preset"]}",')
        lines.append(f'    tradesTotal: {row["trades_total"]},')
        lines.append(f'    winRatePct: {row["win_rate_pct"]},')
        lines.append(f'    profitFactor: {row["profit_factor"]},')
        lines.append(f'    totalReturnPct: {row["total_return_pct"]},')
        lines.append(f'    maxDrawdownPct: {row["max_drawdown_pct"]},')
        lines.append(f'    finalBalance: {row["final_balance"]},')
        wf_pct = row["wf_pct_profitable"] if row["wf_pct_profitable"] is not None else "null"
        wf_rob = row["wf_robustness_score"] if row["wf_robustness_score"] is not None else "null"
        lines.append(f"    wfPctProfitable: {wf_pct},")
        lines.append(f"    wfRobustnessScore: {wf_rob},")
        lines.append(f"    spec: {json.dumps(spec)},")
        lines.append("  },")
    lines.append("];")
    with open("frontend/data/quant-lite-library-sample.ts", "w") as f:
        f.write("\n".join(lines) + "\n")
    print("library rows written:", len(lib))


def gen_sample_result_ts():
    with open("quant-engine/output/q06/MACD_Crossover__execution_mtf__run1.json") as f:
        macd = json.load(f)

    trades = macd["trades"]
    stats = macd["stats"]

    t = []
    t.append("// Real, verified backtest output from this program's own Q0.6 audit run:")
    t.append("// MACD Crossover, XAUUSD_EXNESS, full-year 2024, canonical execution_mtf.py,")
    t.append("// quant_lite_risk_config() (breakeven/trailing/partial confirmed OFF).")
    t.append("// Source: quant-engine/output/q06/MACD_Crossover__execution_mtf__run1.json")
    t.append("// Used as the Quant Lite UI's sample result while no live backend exists yet")
    t.append("// (Q0.7 confirmed none exists) - real, already-computed evidence, not fabricated")
    t.append('// numbers, clearly labeled "Sample result" in the UI per Q0.8\'s honesty rules.')
    t.append('import type { BacktestResult, Trade } from "@/types/quant-lite";')
    t.append("")
    t.append("const SAMPLE_TRADES: Trade[] = [")
    balance = 10000.0
    for i, tr in enumerate(trades):
        balance += tr["pnl"]
        direction = '"BUY"' if tr["direction"] == 1 else '"SELL"'
        t.append("  {")
        t.append(f"    tradeNumber: {i + 1},")
        t.append(f"    direction: {direction},")
        t.append(f'    entryTime: "{tr["entry_time"]}",')
        t.append(f'    entryPrice: {round(tr["entry_price"], 3)},')
        t.append(f'    exitTime: "{tr["exit_time"]}",')
        t.append(f'    exitPrice: {round(tr["exit_price"], 3)},')
        t.append(f'    exitReason: "{tr["reason"]}",')
        t.append(f'    pnl: {round(tr["pnl"], 2)},')
        t.append(f'    balanceAfter: {round(balance, 2)},')
        t.append("  },")
    t.append("];")
    t.append("")
    t.append("export const SAMPLE_BACKTEST_RESULT: BacktestResult = {")
    t.append('  backtestId: "sample-macd-xauusd-2024",')
    t.append('  status: "completed",')
    t.append('  strategyName: "MACD Crossover (Sample)",')
    t.append("  metrics: {")
    t.append(f'    tradesTotal: {stats["trades_total"]},')
    t.append(f'    winRatePct: {stats["win_rate_pct"]},')
    t.append(f'    profitFactor: {stats["profit_factor"]},')
    t.append(f'    totalReturnPct: {stats["total_return_pct"]},')
    t.append(f'    maxDrawdownPct: {stats["max_drawdown_pct"]},')
    t.append(f'    finalBalance: {stats["final_balance"]},')
    t.append(f'    accountBlown: {"true" if stats["account_blown"] else "false"},')
    t.append("    winningTrades: null,")
    t.append("    losingTrades: null,")
    t.append("    averageTrade: null,")
    t.append("    largestWin: null,")
    t.append("    largestLoss: null,")
    t.append("  },")
    t.append("  trades: SAMPLE_TRADES,")
    t.append("  assumptions: {")
    t.append('    executionModel: "Quant Lite Canonical Engine (execution_mtf.py)",')
    t.append('    spread: "Time-varying real market spread",')
    t.append('    slippage: "Not modeled",')
    t.append('    commission: "Not modeled",')
    t.append('    breakeven: "OFF",')
    t.append('    trailing: "OFF",')
    t.append('    partialClose: "OFF",')
    t.append('    dataSource: "XAUUSD_EXNESS (real Exness tick-derived market data)",')
    t.append("  },")
    t.append('  warnings: ["This is a sample result using real, already-verified backtest data '
              'from this program\'s own audit work (Q0.6). Live backend integration is not yet '
              'connected."],')
    t.append("  provenance: {")
    t.append('    symbol: "XAUUSD_EXNESS",')
    t.append('    timeframe: "1h",')
    t.append('    dateRange: { start: "2024-01-01", end: "2024-12-31" },')
    t.append("    initialCapital: 10000,")
    t.append('    engineVersion: "execution_mtf.py (canonical, Q0.6 look-ahead fix applied)",')
    t.append('    generatedAt: "2026-08-24",')
    t.append("  },")
    t.append("};")
    with open("frontend/data/quant-lite-sample-result.ts", "w") as f:
        f.write("\n".join(t) + "\n")
    print("trades written:", len(trades))


if __name__ == "__main__":
    gen_library_ts()
    gen_sample_result_ts()
