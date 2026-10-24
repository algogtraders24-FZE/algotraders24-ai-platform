"""Thin Claude client for the desk: one call per agent, JSON in / JSON out, token + cost + latency logged, daily budget enforced in code.
A failed, slow, malformed or over-budget call NEVER turns into a trade: the caller gets `None` and the safe default (SKIP) applies."""
from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

# Rough list prices in USD per million tokens (input, output). ESTIMATES used only for the budget guard and the dashboard; check your invoice.
PRICE_PER_MTOK = {"claude-sonnet-5-5": (3.0, 15.0), "claude-haiku-5-5": (1.0, 5.0), "claude-opus-5-5": (15.0, 75.0)}
DEFAULT_MODELS = {"scout": "claude-haiku-5-5", "risk_checker": "claude-haiku-5-5", "sentiment": "claude-haiku-5-5", "strategy": "claude-sonnet-5-5",
                  "execution": "claude-haiku-5-5", "risk_manager": "claude-sonnet-5-5", "reviewer": "claude-haiku-5-5"}


def load_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if key:
        return key
    for p in (Path(os.environ.get("AT24_ENV_FILE", "")), Path(__file__).resolve().parents[2] / "frontend" / ".env.local", Path(r"E:\algotraders24-ai-platform\frontend\.env.local")):
        try:
            if p.is_file():
                m = re.search(r"^ANTHROPIC_API_KEY=(.+)$", p.read_text(encoding="utf-8", errors="replace"), re.M)
                if m:
                    return m.group(1).strip().strip("\"'")
        except OSError:
            continue
    return ""


def extract_json(text: str) -> dict | None:
    """The model is told to answer with one JSON object; be tolerant of fences / stray prose, strict about the result being an object."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S).strip()
    try:
        v = json.loads(text)
        return v if isinstance(v, dict) else None
    except json.JSONDecodeError:
        pass
    a, b = text.find("{"), text.rfind("}")
    if a != -1 and b > a:
        try:
            v = json.loads(text[a:b + 1])
            return v if isinstance(v, dict) else None
        except json.JSONDecodeError:
            return None
    return None


@dataclass
class CallLog:
    ts: str
    agent: str
    model: str
    ok: bool
    seconds: float
    tokens_in: int
    tokens_out: int
    cost_usd: float
    error: str = ""


@dataclass
class LLMClient:
    models: dict = field(default_factory=lambda: dict(DEFAULT_MODELS))
    daily_budget_usd: float = 3.0
    max_tokens: int = 1200
    timeout: float = 60.0
    log: list = field(default_factory=list)
    _client: object = None

    def _c(self):
        if self._client is None:
            import anthropic
            key = load_key()
            if not key:
                raise RuntimeError("ANTHROPIC_API_KEY not found (environment or frontend/.env.local)")
            self._client = anthropic.Anthropic(api_key=key, timeout=self.timeout)
        return self._client

    def spent_today(self) -> float:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return sum(c.cost_usd for c in self.log if c.ts.startswith(today))

    def over_budget(self) -> bool:
        return self.spent_today() >= self.daily_budget_usd

    def ask(self, agent: str, system: str, user: str) -> dict | None:
        model = self.models.get(agent, "claude-haiku-5-5")
        if self.over_budget():
            self.log.append(CallLog(datetime.now(timezone.utc).isoformat(), agent, model, False, 0, 0, 0, 0.0, "daily budget reached"))
            return None
        t = time.time()
        try:
            r = self._c().messages.create(model=model, max_tokens=self.max_tokens, system=system, messages=[{"role": "user", "content": user}])
            text = "".join(b.text for b in r.content if getattr(b, "type", "") == "text")
            tin, tout = r.usage.input_tokens, r.usage.output_tokens
            pin, pout = PRICE_PER_MTOK.get(model, (3.0, 15.0))
            cost = (tin * pin + tout * pout) / 1e6
            out = extract_json(text)
            self.log.append(CallLog(datetime.now(timezone.utc).isoformat(), agent, model, out is not None, time.time() - t, tin, tout, cost, "" if out is not None else "not valid JSON"))
            return out
        except Exception as e:  # network, auth, rate limit, timeout: all mean "no decision"
            self.log.append(CallLog(datetime.now(timezone.utc).isoformat(), agent, model, False, time.time() - t, 0, 0, 0.0, f"{type(e).__name__}: {str(e)[:160]}"))
            return None


class FakeLLM:
    """Offline stand-in with the same interface (tests / dry runs). `script` maps agent -> dict or callable(user_text) -> dict | None."""

    def __init__(self, script: dict | None = None):
        self.script = script or {}
        self.log: list[CallLog] = []
        self.calls: list[tuple[str, str]] = []
        self.daily_budget_usd = 1e9

    def spent_today(self) -> float:
        return 0.0

    def over_budget(self) -> bool:
        return False

    def ask(self, agent: str, system: str, user: str) -> dict | None:
        self.calls.append((agent, user))
        v = self.script.get(agent)
        out = v(user) if callable(v) else v
        self.log.append(CallLog(datetime.now(timezone.utc).isoformat(), agent, "fake", out is not None, 0.0, 0, 0, 0.0, "" if out is not None else "fake none"))
        return out
