"""
The strategy SPEC — the one structured format every plain-English idea
gets parsed into. Everything downstream (Python backtest interpreter,
MQL5 codegen, Pine Script codegen) reads from this same spec, so the
three outputs never drift apart.

Supported indicators (v1 — enough to cover most simple retail ideas):
  EMA, SMA, RSI, ATR, MACD, BB (Bollinger Bands)

A condition compares two "refs": a ref is "close"/"open"/"high"/"low",
an indicator id (for single-output indicators), or "id.field" for
multi-output indicators (macd.line, macd.signal, macd.hist,
bb.upper/bb.middle/bb.lower), or a plain number constant.

Example spec (this is what "RSI oversold buy with EMA trend filter"
compiles to):

{
  "name": "RSI Oversold + EMA Trend",
  "symbol": "XAUUSD", "timeframe": "1h",
  "indicators": [
    {"id": "rsi14", "type": "RSI", "period": 14},
    {"id": "ema50", "type": "EMA", "period": 50},
    {"id": "atr14", "type": "ATR", "period": 14}
  ],
  "entry_long":  [{"left": "rsi14", "op": "<", "right": 30},
                  {"left": "close", "op": ">", "right": "ema50"}],
  "entry_short": [{"left": "rsi14", "op": ">", "right": 70},
                  {"left": "close", "op": "<", "right": "ema50"}],
  "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 4.0,
           "atr_id": "atr14"}
}

risk.sl_mode/tp_mode: "ATR" (needs atr_id naming an ATR indicator already in
"indicators") or "PIPS". IMPORTANT: despite the name, sl_points/tp_points
under "PIPS" mode is a raw price-unit distance in the SYMBOL's own price
scale (e.g. 3.0 means $3 for XAUUSD), NOT a broker pip/point count — every
backend (Python runner, MQL5, MQL4, Pine) treats the number identically as
"subtract/add this many price units from the entry price". A real pip
count would need per-symbol digit/point conversion this v1 doesn't do.
"""

import re

VALID_INDICATOR_TYPES = {"EMA", "SMA", "RSI", "ATR", "MACD", "BB",
                          "STOCH", "ADX", "DONCHIAN", "SUPERTREND"}
VALID_OPS = {">", "<", ">=", "<=", "==", "cross_above", "cross_below"}

# Q1.4 Part 18 - indicator ids are embedded VERBATIM and UNQUOTED as
# variable/function names in every generated MQL4/MQL5/Pine artifact
# (codegen_mql4.py/codegen_mql5.py/codegen_pine.py) - never sanitized,
# because sanitizing an identifier (silently mangling it) would make the
# generated code trace back to a different id than the one in the spec,
# breaking provenance. Instead it is validated here and REJECTED outright
# if unsafe (real finding: an id like "i1; Print(1); int x" was confirmed
# to inject arbitrary compilable code into every line that referenced it -
# see Q1.4_SECURITY_VALIDATION.md). A valid identifier in every one of
# MQL4/MQL5/Pine/Python is the intersection this pattern enforces.
ID_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")


PRICE_REFS = {"close", "open", "high", "low"}


def _validate_ref(ref, known_ids: set) -> str:
    """A condition's left/right is a number, a price ref, an indicator id,
    or "id.field" - and (Q1.4 Part 18) every one of those is embedded
    UNQUOTED into generated MQL4/MQL5/Pine source, so each part must be a
    safe identifier. Q1.5 Part 11 addition: a syntactically valid but
    UNDECLARED id (e.g. "NaN", "Infinity", or any typo) previously passed
    this check and produced code referencing an undefined variable - not
    an injection risk (still a safe identifier), but a real "generated
    code doesn't correspond to the submitted spec" defect (Q1.4's own
    Part 4 principle) - found via Q1.5's boundary testing, fixed here by
    requiring the base id to actually be declared. Returns an error
    string, or "" if valid."""
    if isinstance(ref, (int, float)):
        return ""
    if not isinstance(ref, str):
        return f"must be a number or string, got {type(ref).__name__}"
    if ref in PRICE_REFS:
        return ""
    if "." in ref:
        parts = ref.split(".")
        if len(parts) != 2:
            return f"invalid ref (at most one '.' allowed): {ref!r}"
        base, field = parts
        if not ID_PATTERN.match(base) or not ID_PATTERN.match(field):
            return f"invalid ref (both parts must be valid identifiers): {ref!r}"
        if base not in known_ids:
            return f"ref '{ref}' refers to indicator id '{base}', which is not declared in 'indicators'"
        return ""
    if not ID_PATTERN.match(ref):
        return f"invalid ref (must be a number, close/open/high/low, an indicator id, or id.field): {ref!r}"
    if ref not in known_ids:
        return f"ref '{ref}' is not close/open/high/low and is not a declared indicator id"
    return ""


def validate_spec(spec: dict) -> list:
    """Returns a list of error strings (empty = valid)."""
    errors = []
    if "indicators" not in spec:
        errors.append("missing 'indicators'")
        return errors

    ids = set()
    for ind in spec["indicators"]:
        if ind.get("type") not in VALID_INDICATOR_TYPES:
            errors.append(f"unknown indicator type: {ind.get('type')}")
        if "id" not in ind:
            errors.append(f"indicator missing 'id': {ind}")
        elif not ID_PATTERN.match(str(ind["id"])):
            errors.append(f"indicator id must be a valid identifier (letters/digits/underscore, not starting with a digit, max 64 chars): {ind['id']!r}")
        else:
            ids.add(ind["id"])

    for group in ("entry_long", "entry_short"):
        for cond in spec.get(group, []):
            if cond.get("op") not in VALID_OPS:
                errors.append(f"unknown op in {group}: {cond.get('op')}")
            for side in ("left", "right"):
                ref_error = _validate_ref(cond.get(side), ids)
                if ref_error:
                    errors.append(f"{group}.{side}: {ref_error}")

    risk = spec.get("risk", {})
    indicator_types_by_id = {ind.get("id"): ind.get("type") for ind in spec.get("indicators", []) if "id" in ind}
    for mode_key in ("sl_mode", "tp_mode"):
        if risk.get(mode_key) != "ATR":
            continue
        atr_id = risk.get("atr_id")
        if not atr_id:
            errors.append(f"risk.{mode_key}=ATR needs risk.atr_id pointing at an ATR indicator")
        elif indicator_types_by_id.get(atr_id) != "ATR":
            errors.append(f"risk.atr_id '{atr_id}' does not refer to an ATR-type indicator in 'indicators'")

    return errors
