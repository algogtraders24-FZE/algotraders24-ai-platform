"""Registers the USTECH Index Sniper baseline version in the M3 version registry (idempotent).
Run: python add_ustech_registry.py"""
import json
from pathlib import Path

REG = Path(__file__).resolve().parent.parent / "m3-evidence-verification" / "version_registry.json"
KEY = "USTECHSNIPER-v1.00-2025-2026-BASELINE"

entry = {
    "tradingSystemId": "USTECHSNIPER",
    "tradingSystemName": "USTECH Index Sniper (seller-provided EA, US Tech index M1 pending-stop trend-continuation scalper with fair-value-gap entry filter and break-even + fixed trailing exits)",
    "versionString": (
        "v1.00 as-listed - seller-provided .mq5 source (the same trading logic as Gold Sniper, listed under a new name for the US Tech index). "
        "The EA waits for a closed M1 bar inside the London / New York server-time sessions, requires an M5 EMA(50) trend (close above/below a "
        "rising/falling EMA) and a fresh 3-candle M1 fair value gap of at least 8 pips in the same direction, then places ONE BUY STOP / SELL STOP "
        "just beyond the last 5 M1 bars' high/low (30 points buffer, expires after 3 minutes, one position or pending order at a time, 30 s cooldown) "
        "with a fixed pip stop loss / take profit; exits are break-even and trailing. Optional CVD-proxy, entropy/volatility regime and tick order-flow "
        "filters exist in the code but were switched OFF in the tested run. Real MT5 Strategy Tester .html export (Exness-MT5Trial8 build 6230, "
        "Exness symbol USTEC_x100 (Zero account group Idx_Enlarge: contract size 100, maximum 20 lots), M1, 2025.01.01-2026.10.09, 100,000 USD deposit, 43% real-tick history quality; the symbol's data starts 2025-06-15 so the first trade is on 2025-06-16; "
        "the report was produced by the same code under its earlier file name XAU_M1_Pips_Dollar_SLTP_Trailing_Final - the seller states the logic is "
        "unchanged after the rename, which cannot be verified from the files) parsed by M2 (mt5-deals-table-v1), 14,893 trades, tested inputs: "
        "UseRiskLot=true with RiskPercent=2 (compounding lot size, 0.4 lot at the start and capped at 20 lots later), StopLossPips=5000 / "
        "TakeProfitPips=11000 with PipSize=0.01 (= 50 / 110 index points), UsePipsForTrailing=false so the point-based fallback break-even/trailing "
        "(BreakEvenStartPoints=100, BreakEvenLockPoints=20, FixedTrailStartPoints=100, FixedTrailPips=10) was used; EA defaults differ."
    ),
}

d = json.loads(REG.read_text(encoding="utf-8"))
if KEY in d and d[KEY] == entry:
    print("already registered")
else:
    d[KEY] = entry
    REG.write_text(json.dumps(d, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    print("registered", KEY)
