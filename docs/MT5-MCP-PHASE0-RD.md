# AT24 × MT5 MCP — Phase 0 R&D (Discovery, no code)

Status: DRAFT for owner review. Date: 2026-10-06. Implementation NOT authorized.
Scope: audit MetaTrader 5's MCP support, the competitive landscape, and where AT24 can
differentiate. Sequenced AFTER the Beta GO/NO-GO (see `BETA_LAUNCH_LOCK.md`).

## 1. What MT5 provides (verified from MetaQuotes sources)

- MT5 Beta Build 5955+ ships a **native MCP server** and a built-in AI Assistant
  ([announcement](https://www.mql5.com/en/forum/511825), [Build 6060](https://www.metaquotes.net/en/metatrader5/news/5538)).
- External MCP clients (Claude Code, OpenAI Codex, others) can connect. Users bring their own
  API key (OpenAI/Anthropic/Gemini/DeepSeek/Ollama); a free MQL5 Lite model exists.
- Terminal AI Assistant already does: symbol market analysis, position risk review, trading-history
  analysis, Market Watch scanning. MetaEditor assistant does MQL5 codegen/fix/refactor/MQL4→5.
- **Native safety controls exist**: user can allow/prohibit AI-initiated trading, require manual
  confirmation per trade, and control AI network/command-line access.
- **Not documented**: MCP access to Strategy Tester/optimization; the exact tool list. → Phase 0 spike.

Implication: account-level read analysis ("analyze my last 30 trades") is already free inside MT5.
AT24 must not compete there.

## 2. Competitive landscape (open source, as of 2026-10)

MT5 MCP connectors are already commoditized. Examples found:

| Project | Focus |
|---|---|
| [MrBlackSheep91/mt5-mcp](https://github.com/MrBlackSheep91/mt5-mcp) | 28 tools: market data, account, indicators, EAs, analytics, trading |
| [ariadng/metatrader-mcp-server](https://github.com/ariadng/metatrader-mcp-server) | Bridge letting LLMs trade via MT5 |
| [akarachaichp-stack/mt5-mcp](https://github.com/akarachaichp-stack/mt5-mcp) | Quotes, indicators, risk calc, orders, SL/TP, event watcher |
| [amirkhonov/metatrader5-mcp](https://github.com/amirkhonov/metatrader5-mcp) | 32 tools via MT5 Python API |
| [Durex123s/mt5-trading-intelligence-mcp](https://github.com/Durex123s/mt5-trading-intelligence-mcp) | Read-only "trading intelligence" |
| [ali-rajabpour/metatrader-mcp](https://github.com/ali-rajabpour/metatrader-mcp) | Chart screenshots + market data |
| [DonCoyoteS/claude-mt5-trader](https://github.com/DonCoyoteS/claude-mt5-trader) | Strategy builder, walk-forward backtester, demo→live execution |

Adjacent: Alpaca official MCP (stocks/options trading), TradingView/Pine backtest MCPs
(e.g. tv-pinescript-backtest-engine-mcp on Binance Futures data).

**Correction to earlier reasoning:** "first MCP + MT5" is NOT an available early-mover claim.
A thin MT5 connector is a weekend project and many exist. The defensible space is what a
connector cannot replicate: verified intelligence, a real quant/validation engine, a marketplace,
and trust/safety positioning.

## 3. AT24 differentiation (what a generic connector lacks)

1. Deterministic Intelligence Score + verified-answer layer (never a signal engine; honest no-data).
2. Quant engine (at24-quant-engine): backtests, walk-forward (P4.9-B), optimization, Strategy Registry.
3. Marketplace of validated EAs with Trust State (M12).
4. Persistent web dashboard / journal across devices; credit ledger for monetization.
5. Safety posture: read-only + paper only; provenance on every answer.

## 4. Candidate product direction

**A. AT24 MCP server (read-only, external façade).** Exposes tools MT5 lacks:
`market_intelligence`, `quant_backtest`, `walk_forward_check`, `strategy_library_search`,
`economic_calendar`. Reuses existing Agent Framework Tool Registry implementations
(`frontend/services/agent-framework/tools/registry-manifest.ts`); MCP is a façade, not an
internal hop. Every call authenticated, rate-limited, credit-metered, audited.

**B. Trader Edge Analyzer (hero tool).** Input: MT5 account-history statement (HTML/CSV upload) —
no connector, no broker credentials. Output: loss patterns (time/session/lot/streak), edge-reality
score from the quant engine, drawdown/risk-of-ruin, comparison to backtests. Exposed via the web
app first, then as an MCP tool in A. Works for MT4/MT5/cTrader exports.

**C. User-side connector (account data).** DEFERRED. Outbound-only companion on the user's machine,
investor (read-only) password only. Needs security + legal review.

**D. Live trade execution.** OUT OF SCOPE for hosted AT24. Paper trading only. MT5's own
confirmation controls cover the user's local case.

## 5. Threat model highlights (carry into Phase 1)

- Prompt/tool injection via attacker-controlled strings (order comments, symbol names, news).
- Credential custody (avoid entirely: no hosted broker logins).
- Cross-account access / confused deputy; scoped per-user tokens.
- Timeout-after-execution duplicates (moot while read-only/paper).
- LLM-rendered confirmations (confirmation payloads must be deterministic).
- Stale data presented as live (timestamp + source on every response).
- Regulatory exposure of executing trades for others (legal review before any write path).

## 6. Open questions → Phase 0 spikes (when authorized)

1. Enumerate MT5 native MCP tool list and confirm trading-permission behavior with an external client.
2. Confirm whether Strategy Tester/optimization is reachable via MCP at all.
3. Build a throwaway read-only AT24 MCP server with 3 tools; connect Claude Desktop + MT5 AI Assistant.
4. Prototype statement parser (MT5 HTML/CSV) and confirm metrics against known accounts.
5. Legal read on advisory/execution boundaries for any future write path.
6. Demand signal: does anyone outside the team ask for it? (Owner chose to build on conviction; record
   this as an explicit bet, not a validated need.)

## 7. Recommendation

Build B (Trader Edge Analyzer) as the real product; ship A as the MCP distribution channel for it
and for Quant/Intelligence. Position as "safe, validated AI trading analysis" — not "first MT5 MCP".
Keep C deferred, D out of scope. Start only after Beta GO/NO-GO.
