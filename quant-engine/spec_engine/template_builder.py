"""
Option A — zero-AI spec builder. No LLM, no external API call, no network
dependency at all: a user picks from fixed dropdown-style choices (a
trigger, an optional trend filter, a risk preset) and this module
assembles a spec dict directly. This is what a website wizard UI would
call on submit. Every spec produced here is guaranteed to pass
schema.validate_spec() (enforced by a self-test at import time — see
bottom of file) and runs through the exact same runner/codegen pipeline
as the LLM-parsed or hand-written specs.

Catalog design note: indicator ids are namespaced per template family
(trigger_*, filter_*, atrRisk) so combining any one TRIGGER + any one
FILTER + any one RISK preset can never collide.
"""

from .schema import validate_spec

# --- Trigger templates: the core entry signal ------------------------------

TRIGGERS = {
    "rsi_extreme": {
        "label": "RSI oversold / overbought",
        "default_params": {"period": 14, "oversold": 30, "overbought": 70},
        "indicators": lambda p: [{"id": "trigger_rsi", "type": "RSI", "period": p["period"]}],
        "long": lambda p: [{"left": "trigger_rsi", "op": "<", "right": p["oversold"]}],
        "short": lambda p: [{"left": "trigger_rsi", "op": ">", "right": p["overbought"]}],
    },
    "ema_cross": {
        "label": "Fast/slow EMA crossover",
        "default_params": {"fast": 9, "slow": 21},
        "indicators": lambda p: [{"id": "trigger_emaF", "type": "EMA", "period": p["fast"]},
                                  {"id": "trigger_emaS", "type": "EMA", "period": p["slow"]}],
        "long": lambda p: [{"left": "trigger_emaF", "op": "cross_above", "right": "trigger_emaS"}],
        "short": lambda p: [{"left": "trigger_emaF", "op": "cross_below", "right": "trigger_emaS"}],
    },
    "macd_cross": {
        "label": "MACD line crosses signal line",
        "default_params": {"fast": 12, "slow": 26, "signal": 9},
        "indicators": lambda p: [{"id": "trigger_macd", "type": "MACD",
                                   "fast": p["fast"], "slow": p["slow"], "signal": p["signal"]}],
        "long": lambda p: [{"left": "trigger_macd.line", "op": "cross_above", "right": "trigger_macd.signal"}],
        "short": lambda p: [{"left": "trigger_macd.line", "op": "cross_below", "right": "trigger_macd.signal"}],
    },
    "bb_reversion": {
        "label": "Bollinger Band mean reversion (fade the band touch)",
        "default_params": {"period": 20, "mult": 2.0},
        "indicators": lambda p: [{"id": "trigger_bb", "type": "BB", "period": p["period"], "mult": p["mult"]}],
        "long": lambda p: [{"left": "close", "op": "<", "right": "trigger_bb.lower"}],
        "short": lambda p: [{"left": "close", "op": ">", "right": "trigger_bb.upper"}],
    },
    "bb_breakout": {
        "label": "Bollinger Band breakout (ride the band break)",
        "default_params": {"period": 20, "mult": 2.0},
        "indicators": lambda p: [{"id": "trigger_bb", "type": "BB", "period": p["period"], "mult": p["mult"]}],
        "long": lambda p: [{"left": "close", "op": ">", "right": "trigger_bb.upper"}],
        "short": lambda p: [{"left": "close", "op": "<", "right": "trigger_bb.lower"}],
    },
    "stoch_cross": {
        "label": "Stochastic %K crosses %D out of oversold/overbought",
        "default_params": {"k_period": 14, "d_period": 3, "oversold": 20, "overbought": 80},
        "indicators": lambda p: [{"id": "trigger_stoch", "type": "STOCH",
                                   "k_period": p["k_period"], "d_period": p["d_period"]}],
        "long": lambda p: [{"left": "trigger_stoch.k", "op": "cross_above", "right": "trigger_stoch.d"},
                            {"left": "trigger_stoch.k", "op": "<", "right": p["oversold"]}],
        "short": lambda p: [{"left": "trigger_stoch.k", "op": "cross_below", "right": "trigger_stoch.d"},
                             {"left": "trigger_stoch.k", "op": ">", "right": p["overbought"]}],
    },
    "donchian_breakout": {
        "label": "Donchian channel breakout (N-bar high/low break)",
        "default_params": {"period": 20},
        "indicators": lambda p: [{"id": "trigger_don", "type": "DONCHIAN", "period": p["period"]}],
        "long": lambda p: [{"left": "close", "op": ">", "right": "trigger_don.upper"}],
        "short": lambda p: [{"left": "close", "op": "<", "right": "trigger_don.lower"}],
    },
    "supertrend_flip": {
        "label": "Supertrend direction flip",
        "default_params": {"period": 10, "mult": 3.0},
        "indicators": lambda p: [{"id": "trigger_st", "type": "SUPERTREND",
                                   "period": p["period"], "mult": p["mult"]}],
        # trend is a numeric +1/-1 series; crossing zero IS the flip point
        "long": lambda p: [{"left": "trigger_st.trend", "op": "cross_above", "right": 0}],
        "short": lambda p: [{"left": "trigger_st.trend", "op": "cross_below", "right": 0}],
    },
}

# --- Filter templates: optional extra AND-condition on top of the trigger --

FILTERS = {
    "none": {
        "label": "No filter",
        "default_params": {},
        "indicators": lambda p: [],
        "long": lambda p: [],
        "short": lambda p: [],
    },
    "ema_trend": {
        "label": "Only trade with the trend (price vs EMA)",
        "default_params": {"period": 50},
        "indicators": lambda p: [{"id": "filter_ema", "type": "EMA", "period": p["period"]}],
        "long": lambda p: [{"left": "close", "op": ">", "right": "filter_ema"}],
        "short": lambda p: [{"left": "close", "op": "<", "right": "filter_ema"}],
    },
    "rsi_midline": {
        "label": "Only trade with RSI momentum (above/below 50)",
        "default_params": {"period": 14},
        "indicators": lambda p: [{"id": "filter_rsi", "type": "RSI", "period": p["period"]}],
        "long": lambda p: [{"left": "filter_rsi", "op": ">", "right": 50}],
        "short": lambda p: [{"left": "filter_rsi", "op": "<", "right": 50}],
    },
    "adx_strength": {
        "label": "Only trade when the trend is strong (ADX above threshold)",
        "default_params": {"period": 14, "threshold": 25},
        # ADX measures trend STRENGTH, not direction, so this filter applies
        # the same threshold condition to both long and short
        "indicators": lambda p: [{"id": "filter_adx", "type": "ADX", "period": p["period"]}],
        "long": lambda p: [{"left": "filter_adx.adx", "op": ">", "right": p["threshold"]}],
        "short": lambda p: [{"left": "filter_adx.adx", "op": ">", "right": p["threshold"]}],
    },
}

# --- Risk presets: always add a dedicated ATR(14) for SL/TP sizing --------
# Beyond just SL/TP width, each preset also tunes breakeven/trailing/partial
# -close thresholds (mirrors quant_engine's RiskConfig fields, applied via
# runner.py's per-spec overrides) so "conservative" really does lock in
# profit sooner and trail tighter than "aggressive", not just use a smaller
# stop.

RISK_PRESETS = {
    "conservative": {
        "sl_atr_mult": 1.5, "tp_atr_mult": 2.0,
        "be_trigger_atr": 0.5, "be_lock_atr": 0.1,
        "trail_start_atr": 1.0, "trail_atr_mult": 2.0,
        "partial_atr": 1.0, "partial_pct": 0.5,
    },
    "standard": {
        "sl_atr_mult": 2.0, "tp_atr_mult": 4.0,
        "be_trigger_atr": 1.0, "be_lock_atr": 0.1,
        "trail_start_atr": 2.0, "trail_atr_mult": 3.0,
        "partial_atr": 2.0, "partial_pct": 0.5,
    },
    "aggressive": {
        "sl_atr_mult": 1.0, "tp_atr_mult": 1.5,
        "be_trigger_atr": 1.5, "be_lock_atr": 0.2,
        "trail_start_atr": 3.0, "trail_atr_mult": 4.0,
        "partial_atr": 1.5, "partial_pct": 0.3,
    },
}


def list_options():
    """What a website wizard renders as the dropdown choices."""
    return {
        "triggers": {k: v["label"] for k, v in TRIGGERS.items()},
        "filters": {k: v["label"] for k, v in FILTERS.items()},
        "risk_presets": list(RISK_PRESETS.keys()),
    }


def build_spec(name, symbol="XAUUSD", timeframe="1h",
                trigger_key="rsi_extreme", trigger_params=None,
                filter_key="none", filter_params=None,
                risk_key="standard"):
    if trigger_key not in TRIGGERS:
        raise ValueError(f"unknown trigger: {trigger_key}")
    if filter_key not in FILTERS:
        raise ValueError(f"unknown filter: {filter_key}")
    if risk_key not in RISK_PRESETS:
        raise ValueError(f"unknown risk preset: {risk_key}")

    trigger = TRIGGERS[trigger_key]
    filt = FILTERS[filter_key]
    risk_preset = RISK_PRESETS[risk_key]

    tp = {**trigger["default_params"], **(trigger_params or {})}
    fp = {**filt["default_params"], **(filter_params or {})}

    indicators = trigger["indicators"](tp) + filt["indicators"](fp)
    indicators.append({"id": "atrRisk", "type": "ATR", "period": 14})

    entry_long = trigger["long"](tp) + filt["long"](fp)
    entry_short = trigger["short"](tp) + filt["short"](fp)

    spec = {
        "name": name,
        "symbol": symbol,
        "timeframe": timeframe,
        "indicators": indicators,
        "entry_long": entry_long,
        "entry_short": entry_short,
        "risk": {
            "sl_mode": "ATR", "sl_atr_mult": risk_preset["sl_atr_mult"],
            "tp_mode": "ATR", "tp_atr_mult": risk_preset["tp_atr_mult"],
            "atr_id": "atrRisk",
            "be_trigger_atr": risk_preset["be_trigger_atr"], "be_lock_atr": risk_preset["be_lock_atr"],
            "trail_start_atr": risk_preset["trail_start_atr"], "trail_atr_mult": risk_preset["trail_atr_mult"],
            "partial_atr": risk_preset["partial_atr"], "partial_pct": risk_preset["partial_pct"],
        },
        "built_from": {"trigger": trigger_key, "trigger_params": tp,
                        "filter": filter_key, "filter_params": fp, "risk_preset": risk_key},
    }

    errors = validate_spec(spec)
    if errors:
        raise RuntimeError(f"template_builder produced an invalid spec (this is a bug): {errors}")
    return spec


def _self_test():
    """Every trigger x filter combo must build a valid spec. Runs at import."""
    for tkey in TRIGGERS:
        for fkey in FILTERS:
            build_spec(f"selftest_{tkey}_{fkey}", trigger_key=tkey, filter_key=fkey, risk_key="standard")


_self_test()
