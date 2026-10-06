# AT24 AI Tools (MCP) — User Manual

Version 1.0 (draft; becomes live when AT24 enables the MCP service).

AT24 AI Tools lets your own AI app (for example Claude Code or Codex) use AT24's
market, backtest and risk tools directly, in the same chat where you ask questions.
It is **read-only**: it never places trades, never asks for broker or MetaTrader
passwords, and never gives buy/sell signals.

---

## 1. Who is this for?

This is for traders and developers who already use an AI app that supports MCP
(Model Context Protocol). If you do not use such an app, you do not need this: all
AT24 features are available in the AT24 dashboard.

**You need:**
- An AT24 account (any plan can create a token; some tools need a paid plan, see section 5)
- An MCP-compatible AI app that supports remote HTTP servers with a custom
  `Authorization` header (for example Claude Code)
- Optional: MetaTrader 5 with its own MCP enabled (see section 4)

## 2. What you get

| Tool | What it does | Plan |
|---|---|---|
| `market_snapshot` | Latest verified price for an instrument, with source and freshness | All |
| `market_intelligence` | Evidence-based market context for an instrument. Not a signal. Says so when data is insufficient | All |
| `economic_calendar` | This week's scheduled economic events (time, currency, impact, forecast, previous) | All |
| `news_search` | Recent headlines for an instrument (can legitimately return none) | All |
| `strategy_library_search` | Search 100 legacy backtest results by symbol, timeframe, trigger | All |
| `risk_calculator` | Position size from your balance, risk % and stop distance | All |
| `quant_backtest` | Run a backtest on an AT24 strategy and get metrics, trades and equity curve | Paid plan (Quant Pro) |
| `edge_analysis` | Your most recent saved Edge Analyzer analysis: verdict, key numbers, risk scenarios, where results come from. Save one first in the dashboard Edge Analyzer | Paid plan (Quant Pro) |

What it does **not** do: place or manage orders, read your MetaTrader account, give
signals or guarantees, or predict prices. Anything unavailable is reported as
unavailable. AT24 does not guess or fabricate data.

## 3. Set up (about 2 minutes)

### Step 1 — Create a token
1. Sign in to AT24.
2. Open **Account → AI Tools (MCP)** in the dashboard.
3. Enter a name (for example "Laptop Claude Code") and click **Create token**.
4. **Copy the token now.** It is shown only once and cannot be recovered. If you lose it,
   revoke it and create a new one.

Tokens are read-only, expire after 90 days, and you can have up to 5 active tokens.

### Step 2 — Connect your AI app
**Claude Code**

```bash
claude mcp add --transport http at24 https://www.algotraders24.ai/api/mcp --header "Authorization: Bearer YOUR_TOKEN"
```

**Other MCP apps (generic JSON)** — check your app's documentation for where this goes:

```json
{
  "mcpServers": {
    "at24": {
      "url": "https://www.algotraders24.ai/api/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

Use the `www` address exactly as shown. The address without `www` redirects and many apps
drop the token when redirected, which causes an "unauthorized" error.

### Step 3 — Try it
Ask your AI: **"List the AT24 tools you can use."** You should see the tools in section 2.
Then ask: **"Use AT24 to calculate the lot size for a 1% risk on a 10,000 account, entry 2000, stop 1990, with 100 per price unit per lot."**

## 4. Using AT24 together with MetaTrader 5 (optional)

MetaTrader 5 has its own MCP server that runs **on your own PC** (typically
`http://127.0.0.1:22346/mcp`, with its own API key; see MetaQuotes'
[MCP configuration help](https://www.metatrader5.com/en/terminal/help/mcp_and_ai/configuration)).
It gives your AI access to your account, positions and MT5's market data.

You can add **both** servers to the same AI app:
- **MetaTrader 5 MCP** → your account, positions, history, MT5 data
- **AT24 MCP** → verified intelligence, backtests, strategy library, risk math

Then you can ask combined questions, for example: *"Look at my open gold positions (MT5),
check this week's high-impact USD events (AT24), and tell me what lot size 1% risk would be
(AT24)."*

**Important**
- AT24 never connects to your MetaTrader and never needs your MT5 API key. **Do not share your
  MT5 API key with AT24 or anyone else.** It can control your terminal.
- MetaTrader's trading permission settings are yours to control. We recommend keeping AI trading
  disabled or set to require your confirmation.
- AT24 does not currently plug into MetaTrader 5's built-in AI Assistant; use an external AI app
  as described above.

## 5. Plans, limits and fair use

Daily limits per tool (reset at 00:00 UTC):

| Tool | Calls per day |
|---|---|
| `risk_calculator` | 1000 |
| `market_snapshot` | 200 |
| `economic_calendar`, `strategy_library_search` | 100 |
| `market_intelligence`, `news_search` | 20 |
| `quant_backtest` | 5 |
| `edge_analysis` | 100 |

`quant_backtest` and `edge_analysis` require an active paid plan. Without one you will see "plan required". Available
backtest strategies are those in AT24's registry (currently `golden` and `ref-ema-crossover`).
There is also a short-term rate limit; if you hit it, wait a moment and retry.

## 6. Examples of what to ask

- "What is AT24's market context for EURUSD right now? Say if data is insufficient."
- "Show this week's high-impact USD and EUR events."
- "Search AT24's strategy library for XAUUSD 1h strategies with at least 30 trades."
- "Backtest `ref-ema-crossover` on XAUUSD 1h from 2026-01-01 to 2026-06-01 and summarize drawdown and profit factor."
- "Using my saved AT24 edge analysis, what are my biggest weaknesses, and what should I investigate next?"
- "Calculate position size: balance 5,000, risk 0.5%, entry 1.0850, stop 1.0820, 100000 per price unit per lot."

For `risk_calculator`, "value per price unit per lot" depends on your broker's contract size
(for example 100000 for EURUSD, 100 for XAUUSD on many brokers). Check your broker's specification.

## 7. How to read the results

- Every answer includes its source and the time it was retrieved.
- `strategy_library_search` results are labelled **LEGACY-BACKTEST-EVIDENCE**. They come from an
  earlier engine, are **not validated**, and are not recommendations. Re-test before relying on any idea.
- `market_intelligence` is context, not a buy/sell signal.
- Backtests describe the past under stated assumptions; they do not predict future results.

## 8. Troubleshooting

| You see | Meaning / fix |
|---|---|
| Unauthorized / 401 | Token missing, wrong, expired or revoked. Create a new token. Check you used the `www` address |
| "plan required" | `quant_backtest` needs an active paid plan |
| "usage limit reached" | Daily limit for that tool reached; resets at 00:00 UTC |
| "temporarily unavailable" / 503 | The AT24 MCP service is off or in maintenance |
| "too many requests" / 429 | Slow down and retry in about 30 seconds |
| "tool could not complete" | A data source was unavailable. AT24 does not fill gaps with guesses. Retry later |
| Tools not listed | Re-add the server, then restart your AI app |

## 9. Security

- Treat your token like a password. Anyone with it can use your daily limits.
- If it leaks, open **Account → AI Tools (MCP)** and click **Revoke**. It stops working immediately.
- AT24 stores only a hash of your token and never your broker or MetaTrader credentials.
- Each call is logged (tool name, time, success or error) for your usage limits and security. The
  content of your questions and answers is not stored in this log.

## 10. Disclaimer

AT24 AI Tools provide informational analysis only. They are not investment advice, not trading
signals and not a recommendation to buy or sell. Trading involves risk, including loss of capital.
MetaTrader is a trademark of MetaQuotes Ltd.; AT24 is not affiliated with MetaQuotes.
