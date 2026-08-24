"""
Generic Python interpreter for a SPEC — implements the same Strategy
interface as quant_engine/strategies/pullback_breakout.py (compute_indicators
/ init_state / reset_state / next_signal), so ANY spec can run through the
existing quant_engine backtest engine with zero new engine code.

This is what proves a generated idea is real before a single line of
MQL5/Pine gets shown to the user.
"""
import numpy as np
from .indicators import compute_all


def _resolve(ref, row):
    """A ref is a column name, 'id.field', or a numeric constant."""
    if isinstance(ref, (int, float)):
        return ref
    return row[ref]


def _eval_cond(cond, cur, prev):
    left_cur, right_cur = _resolve(cond["left"], cur), _resolve(cond["right"], cur)
    op = cond["op"]
    if op == ">": return left_cur > right_cur
    if op == "<": return left_cur < right_cur
    if op == ">=": return left_cur >= right_cur
    if op == "<=": return left_cur <= right_cur
    if op == "==": return left_cur == right_cur
    if op in ("cross_above", "cross_below"):
        left_prev, right_prev = _resolve(cond["left"], prev), _resolve(cond["right"], prev)
        if op == "cross_above":
            return left_prev <= right_prev and left_cur > right_cur
        return left_prev >= right_prev and left_cur < right_cur
    raise ValueError(f"unknown op {op}")


class SpecStrategy:
    """Wraps a validated spec dict as an engine-compatible Strategy."""

    def __init__(self, spec: dict):
        self.spec = spec
        self.name = spec.get("name", "spec_strategy")
        self.p = spec  # exposed for logging/DB storage, mirrors other strategies' .p

    def compute_indicators(self, df):
        return compute_all(df, self.spec["indicators"])

    def init_state(self):
        return {}

    def reset_state(self, s):
        pass  # condition-based entries have no multi-bar state to reset

    def next_signal(self, i, a, s, spread_price):
        # `a` here is the dict-of-arrays form used by quant_engine's engine.run_backtest;
        # this interpreter instead expects row-dict access, so callers should use
        # spec_engine.runner.run_spec_backtest (a thin pandas-row wrapper) rather than
        # quant_engine.engine.run_backtest directly. See runner.py.
        raise NotImplementedError("use spec_engine.runner.run_spec_backtest")


def evaluate_entry(spec, cur_row, prev_row):
    """Row-dict based evaluator used by runner.py (pandas .itertuples()/.iloc rows)."""
    long_conds = spec.get("entry_long", [])
    short_conds = spec.get("entry_short", [])

    long_ok = bool(long_conds) and all(_eval_cond(c, cur_row, prev_row) for c in long_conds)
    short_ok = bool(short_conds) and all(_eval_cond(c, cur_row, prev_row) for c in short_conds)

    if long_ok and not short_ok:
        return 1
    if short_ok and not long_ok:
        return -1
    return 0
