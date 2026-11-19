"""Optional: push the paper results to the AT24 website (admin 'Arena' page). Reads two environment variables:
  AT24_ARENA_TOKEN   the same secret as ARENA_INGEST_SECRET on the website (no token = nothing is sent)
  AT24_ARENA_URL     default https://www.algotraders24.ai/api/arena/ingest
Only paper results are sent - never an exchange key. A failed push is logged and ignored: the bot never depends on the website."""
from __future__ import annotations

import json
import math
import os

import requests

DEFAULT_URL = "https://www.algotraders24.ai/api/arena/ingest"


def clean(o):
    """Strict JSON: NaN / inf become null (the website rejects non-standard numbers)."""
    if isinstance(o, float) and (math.isnan(o) or math.isinf(o)):
        return None
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    return o


class ArenaPush:
    def __init__(self, token: str, url: str = DEFAULT_URL, session: requests.Session | None = None):
        self.token, self.url = token, url
        self.s = session or requests.Session()
        self.last_error = ""

    @classmethod
    def from_env(cls) -> "ArenaPush | None":
        token = os.environ.get("AT24_ARENA_TOKEN", "").strip()
        return cls(token, os.environ.get("AT24_ARENA_URL", DEFAULT_URL).strip() or DEFAULT_URL) if token else None

    def _post(self, body: dict) -> bool:
        try:
            r = self.s.post(self.url, data=json.dumps(clean(body), allow_nan=False), headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}, timeout=10)
            if r.status_code == 200:
                self.last_error = ""
                return True
            self.last_error = f"HTTP {r.status_code} {r.text[:80]}"
        except Exception as e:  # network, encoding, anything: the bot must never depend on the website
            self.last_error = f"{type(e).__name__}: {str(e)[:80]}"
        return False

    def full(self, payload: dict) -> bool:
        return self._post({"kind": "full", "payload": payload})

    def live(self, live: dict) -> bool:
        return self._post({"kind": "live", "live": live})
