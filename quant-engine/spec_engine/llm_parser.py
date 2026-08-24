"""
Plain-English/Hinglish trading idea -> validated SPEC, via the Claude API's
tool-use (forced structured output) so the model can't return free-form text
that fails to parse. Every spec that comes out of parse_idea_to_spec() is
guaranteed to pass schema.validate_spec() (self-correcting retry loop) before
it's ever handed to the backtester or the code generators.

Production usage (Next.js API route calls the TS mirror of this; this Python
module is the reference implementation + what the local prototype/demo use):

    from spec_engine.llm_parser import parse_idea_to_spec
    spec = parse_idea_to_spec("buy when RSI(14) dips below 30 and price is above EMA50")
    # spec is a dict guaranteed to pass validate_spec()

Requires ANTHROPIC_API_KEY in the environment. Model id is read from
ANTHROPIC_MODEL (defaults to a current Claude model) so it stays out of code
and can track whatever model the deployment is pinned to.
"""
import os
import json

from .schema import validate_spec

DEFAULT_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-5-20250929")
MAX_REPAIR_ATTEMPTS = 3

SYSTEM_PROMPT = """You convert a trader's plain-language (English or Hinglish) \
description of an entry idea into a strict JSON trading spec. You MUST call \
the emit_trading_spec tool exactly once with a spec that follows these rules:

- indicators: list of {id, type, ...params}. type is one of EMA, SMA, RSI, ATR, MACD, BB.
  EMA/SMA/RSI/ATR take "period". MACD takes "fast"/"slow"/"signal" (default 12/26/9).
  BB takes "period" (default 20) and "mult" (default 2.0). Give every indicator a
  short unique id (e.g. "ema50", "rsi14", "macd1", "bb1").
- entry_long / entry_short: lists of conditions ANDed together. Each condition is
  {"left": ref, "op": one of > < >= <= == cross_above cross_below, "right": ref}.
  A ref is "close"/"open"/"high"/"low", an indicator id (single-output indicators),
  "id.field" for multi-output indicators (macd1.line, macd1.signal, macd1.hist,
  bb1.upper, bb1.middle, bb1.lower), or a plain number.
- risk: {"sl_mode": "ATR"|"PIPS", "sl_atr_mult" or "sl_points", "tp_mode": "ATR"|"PIPS",
  "tp_atr_mult" or "tp_points", "atr_id": id of an ATR indicator in the list}.
  If the idea doesn't specify stops, default to ATR-based 2x SL / 4x TP and include
  an ATR(14) indicator for that purpose even if the idea's entry logic doesn't use it.
  IMPORTANT: despite the name, "PIPS" mode's sl_points/tp_points is a raw price-unit
  distance (e.g. 3.0 means $3 for XAUUSD), NOT a broker pip count — do not convert
  the idea's stated pip count, just use ATR mode instead unless the idea gives an
  explicit dollar/price distance.
- Only use indicator types EMA/SMA/RSI/ATR/MACD/BB — nothing else exists yet. If the
  idea needs something outside that set (e.g. "highest high of last N bars",
  candlestick patterns, volume), still emit your closest valid approximation using
  only the supported indicators, and say what was approximated in "notes".
- symbol/timeframe: infer from the idea if stated, else default symbol "XAUUSD",
  timeframe "1h".
- name: a short human-readable title for the idea.

Never invent indicator types or condition ops outside the lists above."""

SPEC_TOOL = {
    "name": "emit_trading_spec",
    "description": "Emit the structured trading spec parsed from the user's idea.",
    "input_schema": {
        "type": "object",
        "required": ["name", "symbol", "timeframe", "indicators", "risk"],
        "properties": {
            "name": {"type": "string"},
            "symbol": {"type": "string"},
            "timeframe": {"type": "string"},
            "notes": {"type": "string", "description": "Any approximations made vs. the original idea."},
            "indicators": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["id", "type"],
                    "properties": {
                        "id": {"type": "string"},
                        "type": {"type": "string", "enum": ["EMA", "SMA", "RSI", "ATR", "MACD", "BB"]},
                        "period": {"type": "integer"},
                        "fast": {"type": "integer"},
                        "slow": {"type": "integer"},
                        "signal": {"type": "integer"},
                        "mult": {"type": "number"},
                    },
                },
            },
            "entry_long": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["left", "op", "right"],
                    "properties": {
                        "left": {},
                        "op": {"type": "string",
                               "enum": [">", "<", ">=", "<=", "==", "cross_above", "cross_below"]},
                        "right": {},
                    },
                },
            },
            "entry_short": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["left", "op", "right"],
                    "properties": {
                        "left": {},
                        "op": {"type": "string",
                               "enum": [">", "<", ">=", "<=", "==", "cross_above", "cross_below"]},
                        "right": {},
                    },
                },
            },
            "risk": {
                "type": "object",
                "required": ["sl_mode", "tp_mode"],
                "properties": {
                    "sl_mode": {"type": "string", "enum": ["ATR", "PIPS"]},
                    "sl_atr_mult": {"type": "number"},
                    "sl_points": {"type": "number"},
                    "tp_mode": {"type": "string", "enum": ["ATR", "PIPS"]},
                    "tp_atr_mult": {"type": "number"},
                    "tp_points": {"type": "number"},
                    "atr_id": {"type": "string"},
                },
            },
        },
    },
}


def _extract_tool_input(message):
    for block in message.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "emit_trading_spec":
            return dict(block.input)
    raise RuntimeError("model did not call emit_trading_spec")


def parse_idea_to_spec(idea_text: str, model: str = None) -> dict:
    """Returns a spec dict guaranteed to pass validate_spec(). Raises on
    unrecoverable failure after MAX_REPAIR_ATTEMPTS."""
    import anthropic  # imported lazily so the rest of spec_engine has no hard dep

    client = anthropic.Anthropic()
    model = model or DEFAULT_MODEL

    messages = [{"role": "user", "content": f"Idea: {idea_text}"}]

    for attempt in range(MAX_REPAIR_ATTEMPTS):
        resp = client.messages.create(
            model=model,
            max_tokens=1500,
            system=SYSTEM_PROMPT,
            tools=[SPEC_TOOL],
            tool_choice={"type": "tool", "name": "emit_trading_spec"},
            messages=messages,
        )
        spec = _extract_tool_input(resp)
        errors = validate_spec(spec)
        if not errors:
            return spec

        # self-correction: feed the validator's own errors back to the model
        messages.append({"role": "assistant", "content": resp.content})
        messages.append({
            "role": "user",
            "content": f"That spec failed validation: {errors}. Call emit_trading_spec "
                       f"again with a corrected spec that fixes exactly these problems.",
        })

    raise RuntimeError(f"could not produce a valid spec after {MAX_REPAIR_ATTEMPTS} attempts: {errors}")
