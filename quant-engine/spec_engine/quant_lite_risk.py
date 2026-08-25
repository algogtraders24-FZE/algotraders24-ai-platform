"""
The Quant Lite-facing RiskConfig boundary (Q0.4).

Q0.3 established that quant_engine/engine.py::RiskConfig defaults
breakeven, ATR trailing, and 50% partial-close all to True, that every
call site in this repository leaves those defaults unmodified, and that
none of the three code generators (codegen_mql5.py/codegen_mql4.py/
codegen_pine.py) implement any of the three - so a Python backtest run
with the class defaults reports behavior the exported strategy cannot
reproduce.

This module does not change RiskConfig itself (its class defaults stay
exactly as they are - other, non-Quant-Lite consumers of the legacy
engine are unaffected) and does not remove or alter the breakeven/
trailing/partial-close implementation anywhere. It is a single, explicit,
named construction path: anything that wants a Quant-Lite-honest backtest
imports quant_lite_risk_config() from here instead of constructing
RiskConfig(...) directly with the (feature-mismatched) class defaults.

    from spec_engine.quant_lite_risk import quant_lite_risk_config
    risk = quant_lite_risk_config(risk_pct=1.0, spread_price=0.30,
                                   contract_size=100, start_balance=10000)

Everything about risk_pct/spread_price/contract_size/start_balance
(and any other RiskConfig field) works exactly as before - this changes
only the three position-management booleans, explicitly, in one place.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "quant_engine"))
from engine import RiskConfig  # noqa: E402


def quant_lite_risk_config(**kw) -> RiskConfig:
    """Builds a RiskConfig for the Quant Lite-facing backtest path:
    breakeven, ATR trailing, and partial-close are forced OFF, matching
    what codegen_mql5.py/codegen_mql4.py/codegen_pine.py actually
    generate (none of the three implement any of them - see
    QUANT_LITE_EXECUTION_GAP_REPORT.md GAP-01/02/03). Every other
    RiskConfig field (risk_pct, spread_price, contract_size,
    start_balance, SL/TP-related fields, use_daily_limit, etc.) is
    passed through unchanged via **kw, and a caller CANNOT accidentally
    re-enable the three via **kw - they are pinned after the caller's
    kwargs are applied, not merely defaulted, so this function's contract
    (BE/trailing/partial always OFF) can never be silently bypassed by a
    stray keyword argument.
    """
    kw["use_breakeven"] = False
    kw["use_trailing"] = False
    kw["use_partial"] = False
    return RiskConfig(**kw)
