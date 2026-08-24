"""
Auto-suggest variations for an idea that backtests as a loser. Generic —
works on ANY valid spec (wizard-built, LLM-parsed, or hand-written), not
just template_builder specs, since it only touches the common spec shape
(indicators/entry_long/entry_short/risk) guaranteed by schema.py.

Honesty by construction: find_improvements() backtests every candidate
and only reports the ones that actually beat the original's profit
factor. If none do, it says so — it does NOT pick "the best of a bad
lot" and present it as a fix.
"""
import copy

from .schema import validate_spec

RISK_CANDIDATES = [(1.5, 2.0, "tighter SL/TP"), (2.0, 3.0, "balanced SL/TP"), (1.0, 3.0, "wider reward:risk")]


def _clone(spec):
    return copy.deepcopy(spec)


def _next_id(spec, base):
    existing = {ind["id"] for ind in spec["indicators"]}
    i = 1
    while f"{base}{i}" in existing:
        i += 1
    return f"{base}{i}"


def variant_risk(spec, sl_mult, tp_mult, label):
    risk = spec.get("risk", {})
    if risk.get("sl_atr_mult") == sl_mult and risk.get("tp_atr_mult") == tp_mult:
        return None, None
    v = _clone(spec)
    v.setdefault("risk", {})
    v["risk"]["sl_mode"] = "ATR"
    v["risk"]["tp_mode"] = "ATR"
    v["risk"]["sl_atr_mult"] = sl_mult
    v["risk"]["tp_atr_mult"] = tp_mult
    if not v["risk"].get("atr_id"):
        return None, None  # can't do ATR-mode risk without an ATR indicator already in the spec
    v["name"] = f"{spec.get('name', 'idea')} [risk: {label}]"
    return v, f"changed risk to SL={sl_mult}x ATR / TP={tp_mult}x ATR ({label})"


def variant_add_ema_trend_filter(spec, period=50):
    v = _clone(spec)
    fid = _next_id(v, "autoFilterEma")
    v["indicators"].append({"id": fid, "type": "EMA", "period": period})
    v.setdefault("entry_long", []).append({"left": "close", "op": ">", "right": fid})
    v.setdefault("entry_short", []).append({"left": "close", "op": "<", "right": fid})
    v["name"] = f"{spec.get('name', 'idea')} [+EMA{period} trend filter]"
    return v, f"added an EMA({period}) trend filter — only take the signal in the direction of the trend"


def variant_add_adx_strength_filter(spec, period=14, threshold=25):
    v = _clone(spec)
    fid = _next_id(v, "autoFilterAdx")
    v["indicators"].append({"id": fid, "type": "ADX", "period": period})
    v.setdefault("entry_long", []).append({"left": f"{fid}.adx", "op": ">", "right": threshold})
    v.setdefault("entry_short", []).append({"left": f"{fid}.adx", "op": ">", "right": threshold})
    v["name"] = f"{spec.get('name', 'idea')} [+ADX>{threshold} strength filter]"
    return v, f"added an ADX({period})>{threshold} filter — only trade when there's a real trend to trade"


def variant_nudge_thresholds(spec, factor, label):
    v = _clone(spec)
    changed = False
    for group in ("entry_long", "entry_short"):
        for cond in v.get(group, []):
            if isinstance(cond.get("right"), (int, float)) and cond["op"] in (">", "<", ">=", "<="):
                cond["right"] = round(cond["right"] * factor, 2)
                changed = True
    if not changed:
        return None, None
    v["name"] = f"{spec.get('name', 'idea')} [thresholds {label}]"
    return v, f"nudged the numeric entry thresholds {label} (x{factor})"


def suggest_variations(spec):
    """Returns [(variant_spec, human_description), ...] — candidates only,
    not yet backtested."""
    candidates = []
    for sl, tp, label in RISK_CANDIDATES:
        v, desc = variant_risk(spec, sl, tp, label)
        if v:
            candidates.append((v, desc))

    v, desc = variant_add_ema_trend_filter(spec)
    candidates.append((v, desc))
    v, desc = variant_add_adx_strength_filter(spec)
    candidates.append((v, desc))

    for factor, label in [(0.8, "tighter"), (1.2, "looser")]:
        v, desc = variant_nudge_thresholds(spec, factor, label)
        if v:
            candidates.append((v, desc))

    return candidates


def find_improvements(df, spec, risk_config, run_spec_backtest, min_trades=30, top_n=3):
    """Backtests the original + every candidate variation. Returns a dict
    with the honest verdict — 'improved' is empty if nothing beat the
    original, and that's a valid, reportable outcome."""
    _, _, base_metrics = run_spec_backtest(df, spec, risk_config)
    base_pf = base_metrics.get("profit_factor") or 0

    tried = []
    for variant_spec, desc in suggest_variations(spec):
        if validate_spec(variant_spec):
            continue
        try:
            _, _, m = run_spec_backtest(df, variant_spec, risk_config)
        except Exception as e:
            continue
        if m.get("trades_total", 0) < min_trades:
            continue
        tried.append({"description": desc, "spec": variant_spec, "metrics": m})

    tried.sort(key=lambda r: (r["metrics"].get("profit_factor") or 0), reverse=True)
    improved = [r for r in tried if (r["metrics"].get("profit_factor") or 0) > base_pf]

    return {
        "base_name": spec.get("name"),
        "base_metrics": base_metrics,
        "base_profit_factor": base_pf,
        "n_candidates_tried": len(tried),
        "improved": improved[:top_n],
        "verdict": "improved" if improved else "no_improvement",
    }
