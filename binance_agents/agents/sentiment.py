"""Agent 3 - Sentiment: order-book pressure. A veto-only agent: it can stop an entry (heavy selling pressure in the book right now) but
it never creates one. Social-media sentiment is deliberately NOT used: it has no verified edge and is easy to fake.
It cannot be backtested (historical order books are not available), so the backtest treats it as neutral and says so."""
from __future__ import annotations

from ..config import Live


class Sentiment:
    def __init__(self, live: Live):
        self.live = live

    @staticmethod
    def imbalance(book: dict) -> float:
        """Bid share of the notional depth within 0.5% of the mid price (0.5 = balanced, <0.4 = sellers dominate)."""
        bids = [(float(p), float(q)) for p, q in book["bids"]]
        asks = [(float(p), float(q)) for p, q in book["asks"]]
        if not bids or not asks:
            return 0.5
        mid = (bids[0][0] + asks[0][0]) / 2.0
        b = sum(p * q for p, q in bids if p >= mid * 0.995)
        a = sum(p * q for p, q in asks if p <= mid * 1.005)
        return b / (a + b) if (a + b) > 0 else 0.5

    def veto(self, book: dict) -> tuple[bool, str]:
        im = self.imbalance(book)
        if im < self.live.min_book_imbalance:
            return True, f"order book is sell-heavy (bid share {im:.2f})"
        return False, f"bid share {im:.2f}"
