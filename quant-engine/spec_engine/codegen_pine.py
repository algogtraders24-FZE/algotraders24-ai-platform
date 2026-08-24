"""
Spec -> TradingView Pine Script v5 strategy source. Same indicator math
and condition logic as indicators.py/interpreter.py (and the same spec
that drives codegen_mql5.py), so all three surfaces (Python backtest,
MQL5 EA, Pine strategy) stay in lockstep with a single source of truth.
"""

PRICE_REFS = {"close", "open", "high", "low"}


def _var_name(ref):
    if isinstance(ref, (int, float)):
        return str(ref)
    if ref in PRICE_REFS:
        return ref  # Pine has close/open/high/low as built-ins already
    if "." in ref:
        base, field = ref.split(".")
        return f"{base}_{field}"
    return ref


def _indicator_lines(indicators):
    """Returns a list of Pine `var_name = ta.xxx(...)` declaration lines."""
    lines = []
    for ind in indicators:
        iid, t = ind["id"], ind["type"]
        if t == "EMA":
            lines.append(f"{iid} = ta.ema(close, {ind['period']})")
        elif t == "SMA":
            lines.append(f"{iid} = ta.sma(close, {ind['period']})")
        elif t == "RSI":
            lines.append(f"{iid} = ta.rsi(close, {ind['period']})")
        elif t == "ATR":
            lines.append(f"{iid} = ta.atr({ind['period']})")
        elif t == "MACD":
            fast, slow, sig = ind.get("fast", 12), ind.get("slow", 26), ind.get("signal", 9)
            lines.append(f"[{iid}_line, {iid}_signal, {iid}_hist] = ta.macd(close, {fast}, {slow}, {sig})")
        elif t == "BB":
            period, mult = ind.get("period", 20), ind.get("mult", 2.0)
            lines.append(f"{iid}_middle = ta.sma(close, {period})")
            lines.append(f"{iid}_stdev = ta.stdev(close, {period})")
            lines.append(f"{iid}_upper = {iid}_middle + {mult} * {iid}_stdev")
            lines.append(f"{iid}_lower = {iid}_middle - {mult} * {iid}_stdev")
        elif t == "STOCH":
            kp, dp = ind.get("k_period", 14), ind.get("d_period", 3)
            lines.append(f"{iid}_k = ta.stoch(close, high, low, {kp})")
            lines.append(f"{iid}_d = ta.sma({iid}_k, {dp})")
        elif t == "ADX":
            period = ind.get("period", 14)
            # ta.dmi returns [+DI, -DI, ADX] directly — same Wilder math as indicators.py
            lines.append(f"[{iid}_plus_di, {iid}_minus_di, {iid}_adx] = ta.dmi({period}, {period})")
        elif t == "DONCHIAN":
            period = ind.get("period", 20)
            # high[1]/low[1]: prior-bar-shifted series, so the channel excludes
            # the current bar's own high/low — matches indicators.py's donchian()
            lines.append(f"{iid}_upper = ta.highest(high[1], {period})")
            lines.append(f"{iid}_lower = ta.lowest(low[1], {period})")
            lines.append(f"{iid}_middle = ({iid}_upper + {iid}_lower) / 2")
        elif t == "SUPERTREND":
            period, mult = ind.get("period", 10), ind.get("mult", 3.0)
            # Pine's built-in direction convention is direction<0=uptrend,
            # direction>0=downtrend — OPPOSITE of indicators.py's supertrend()
            # (+1=uptrend/-1=downtrend). Flip the sign here so a spec's
            # trend conditions mean the same thing in Python/MQL5/Pine.
            lines.append(f"[{iid}_line, {iid}_dirRaw] = ta.supertrend({mult}, {period})")
            lines.append(f"{iid}_trend = -{iid}_dirRaw")
        else:
            raise ValueError(f"unsupported indicator type {t}")
    return lines


def _cond_to_pine(cond):
    left, op, right = cond["left"], cond["op"], cond["right"]
    lv, rv = _var_name(left), _var_name(right)
    if op in (">", "<", ">=", "<=", "=="):
        opsym = "==" if op == "==" else op
        return f"({lv} {opsym} {rv})"
    if op == "cross_above":
        return f"ta.crossover({lv}, {rv})"
    if op == "cross_below":
        return f"ta.crossunder({lv}, {rv})"
    raise ValueError(op)


def generate_pine(spec: dict) -> str:
    indicators = spec["indicators"]
    ind_lines = _indicator_lines(indicators)

    long_conds = spec.get("entry_long", [])
    short_conds = spec.get("entry_short", [])
    long_expr = " and ".join(_cond_to_pine(c) for c in long_conds) if long_conds else "false"
    short_expr = " and ".join(_cond_to_pine(c) for c in short_conds) if short_conds else "false"

    risk = spec.get("risk", {})
    atr_id = risk.get("atr_id")
    sl_mode, tp_mode = risk.get("sl_mode", "ATR"), risk.get("tp_mode", "ATR")

    # "PIPS" mode's sl_points/tp_points is a raw price-unit distance (see
    # schema.py's docstring), matched exactly here — no unit conversion —
    # so it means the same $/price distance as runner.py/MQL5/MQL4.
    if sl_mode == "ATR":
        sl_dist_expr = f"{atr_id} * {risk.get('sl_atr_mult', 2.0)}"
    else:
        sl_dist_expr = str(risk.get("sl_points", 3.0))

    if tp_mode == "ATR":
        tp_dist_expr = f"{atr_id} * {risk.get('tp_atr_mult', 4.0)}"
    else:
        tp_dist_expr = str(risk.get("tp_points", 6.0))

    name = spec.get("name", "Generated Strategy")
    title = name.replace('"', "'")

    return f"""//@version=5
// {title} — AUTO-GENERATED from spec by the AT24 idea-to-code engine.
// Same indicator math + entry logic as the paired MQL5 EA and the
// Python backtest this was verified against. Review before live use.
strategy("{title}", overlay=true, default_qty_type=strategy.fixed,
     default_qty_value=1, pyramiding=0, calc_on_every_tick=false)

riskPercent = input.float(1.0, "Risk % per trade", minval=0.01)

{chr(10).join(ind_lines)}

longSignal  = {long_expr}
shortSignal = {short_expr}

slDist = {sl_dist_expr}
tpDist = {tp_dist_expr}

// Risk-based position size, same formula as CalcLots() in the paired MQL
// EAs: riskMoney / (stop distance converted to account-currency loss per
// contract via syminfo.pointvalue). Without this, Pine's strategy.entry
// would size every trade the same regardless of stop distance — silently
// disconnected from the risk% the wizard/spec actually asked for.
riskMoney = strategy.equity * (riskPercent / 100.0)
slDistPoints = slDist / syminfo.mintick
lossPerContract = slDistPoints * syminfo.pointvalue
qty = lossPerContract > 0 ? riskMoney / lossPerContract : 0.0

// SL/TP distance is frozen at the signal bar (matches Python/MQL: the ATR
// used for sizing a trade doesn't drift after entry), but the price LEVELS
// are anchored to strategy.position_avg_price (the real average fill),
// recomputed every bar while in the trade — not the signal bar's close,
// which with calc_on_every_tick=false is NOT the fill price (entry fills
// at the next bar's open, so a gap between signal-close and fill-open
// would otherwise silently widen/narrow the realized stop).
var float frozenSlDist = na
var float frozenTpDist = na

if (longSignal and strategy.position_size == 0 and qty > 0)
    frozenSlDist := slDist
    frozenTpDist := tpDist
    strategy.entry("Long", strategy.long, qty=qty)

if (shortSignal and strategy.position_size == 0 and qty > 0)
    frozenSlDist := slDist
    frozenTpDist := tpDist
    strategy.entry("Short", strategy.short, qty=qty)

if strategy.position_size > 0
    strategy.exit("Long Exit", from_entry="Long",
         stop=strategy.position_avg_price - frozenSlDist,
         limit=strategy.position_avg_price + frozenTpDist)

if strategy.position_size < 0
    strategy.exit("Short Exit", from_entry="Short",
         stop=strategy.position_avg_price + frozenSlDist,
         limit=strategy.position_avg_price - frozenTpDist)
"""
