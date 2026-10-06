# AT24 MCP Server — v1 Tool Spec (read-only)

Status: DRAFT, owner-approved scope (2026-10-06). Builds on `MT5-MCP-PHASE0-RD.md`.
Positioning: "Validated, safe AI trading analysis." Works with any MCP client (Claude Desktop,
Cursor, MT5 AI Assistant, other MT5 MCP connectors). Never executes trades, never holds broker
credentials, never emits signals.

## 1. Architecture (reuses existing code)

```text
External MCP client (Claude Desktop / Cursor / MT5 Assistant)
        |  Streamable HTTP, Bearer AT24 API token
        v
POST /api/mcp   (Next.js route, stateless)
  1. authenticate token -> userId + plan   (NEW: ApiToken)
  2. rate limit per token
  3. map MCP tool -> AF tool id, build AuthorizedToolIntent
  4. invokeTool(...)  <- EXISTING services/agent-framework/tools/tool-gateway.ts
        (permission check, input/output validation, timeout, evidence)
  5. credit debit via existing ledger (A9) for metered tools
  6. audit row; return result + provenance
        |
        v
EXISTING tool implementations (services/agent-framework/tools/impl/*)
```

Principles: the MCP route is a THIN FACADE. No tool logic lives in it. Internal agents keep using the
Tool Registry directly (no MCP hop internally). Permission contract already rejects
`CAN_CREATE_ORDER` / `CAN_EXECUTE_ORDER` (`types/agent-framework/permission-contract.ts`), so write
tools are structurally impossible in v1.

## 2. v1 tools

| MCP tool | AF tool id / source | Status today | Permission | Credits (placeholder) | Plan |
|---|---|---|---|---|---|
| `market_snapshot` | `market.snapshot` | registered | CAN_READ_MARKET_DATA | 1 | Free |
| `market_intelligence` | `market.intelligence` | registered | CAN_READ_MARKET_DATA | 4 | Free (limited/day) |
| `quant_backtest` | `backtest.run` | registered | CAN_RUN_BACKTEST | 8 | Credits |
| `news_search` | `news.search` | registered | CAN_READ_NEWS | 2 | Free (limited) |
| `economic_calendar` | `services/calendar/calendar.service.ts` | ADAPTER NEEDED | CAN_READ_MARKET_DATA | 1 | Free |
| `strategy_library_search` | Strategy Library data | ADAPTER NEEDED (locate source) | CAN_RUN_RESEARCH | 1 | Free |
| `risk_calculator` | pure deterministic math | NEW | none (no I/O) | 0 | Free |

Credit numbers are the existing PLACEHOLDERS (`tool-credit-costs.ts`); pricing is an owner decision.
`portfolio.read` / `support.*` / `research.knowledge_search` are internal and NOT exposed.

### Per-tool contract notes
- Every response: `{ data, provenance: { source, retrievedAt, freshness }, dataQuality }`. Honest
  "unavailable" instead of fabricated values (e.g. Gold/Silver provider limits).
- `market_snapshot`: `{ symbol }`. Rejects unknown/oversized symbols.
- `market_intelligence`: `{ symbol, timeframe? }`. Returns evidence-backed context; never a buy/sell signal.
- `quant_backtest`: `{ strategySpec }` validated by existing `validateStrategySpec`; default window last
  ~2 years; hard runtime ceiling; async-safe timeout error.
- `risk_calculator`: `{ accountBalance, riskPercent, entry, stopLoss, symbolSpec }` -> lot size, risk
  amount, R-multiples. Bounds: riskPercent 0 < x <= 100; prices > 0; deterministic, unit-tested. It
  computes position size for the user's own planning only; it is not advice.

## 3. Out of scope for v1 (explicit)
Order place/modify/close; broker/account credentials; account/positions/history (use MT5's own
assistant or a user-side connector); signals; walk-forward and EA codegen (v1.1, plan-gated);
chart screenshots, key levels, liquidity zones (v1.1+); Trader Edge Analyzer (separate product).

## 4. Security requirements (v1)
- Auth: per-user API token, shown once, stored HASHED (same pattern as license `apiKeyHash`), revocable,
  scoped (`read` only in v1), optional expiry, last-used timestamp.
- Never trust client-supplied userId; token -> userId only.
- Per-token rate limits + daily quota per tool; credits via existing ledger; fail closed on any error.
- Input validation by existing parse guards; output size caps; request body size cap.
- Tool-injection: tool OUTPUT is data; responses carry no instructions; strings from news/third parties
  are returned inside typed fields and length-capped.
- Audit log per call (token id, tool, status, duration, credits) — no payload secrets.
- Kill switch: env flag disables `/api/mcp` instantly; per-token revoke.
- CORS: not browser-facing; reject cookie-session auth on this route (CSRF-safe by design).

## 5. Decisions needing owner sign-off before code that touches shared state
1. **ApiToken table** => Prisma migration on the SHARED prod DB. Will be written as additive-only SQL and
   NOT applied without explicit go-ahead.
2. **New dependency** `@modelcontextprotocol/sdk` (official; already present transitively in the lockfile).
3. **Pricing** of credits per tool (placeholders today).
4. **Free-tier daily quotas** for market_intelligence / news_search.

## 6. Build increments
- I1: tool catalog + facade core (mapping, auth interface, intent building, audit hook) with unit tests,
  using an injected authenticator (no DB). Plus `risk_calculator` (pure).
- I2: adapters `economic_calendar`, `strategy_library_search`.
- I3: ApiToken model + migration (gated) + token issue/revoke UI under dashboard Account.
- I4: `/api/mcp` route (Streamable HTTP), rate limits, kill switch, metering.
- I5: end-to-end verification with Claude Desktop + MT5 AI Assistant; security regression
  (unauthorized tool, cross-user, replay, oversize, injection strings).
- I6: docs page + positioning/claims policy; listing in MCP registries.

## 7. Claims policy (positioning)
Allowed: "validated", "verified sources", "read-only", "works with any MCP client", "tells you when data
is unavailable". Not allowed: "first MT5 MCP", profit/accuracy claims, signals, "AI trades for you".
Any capability claim must be verified against production before it is published.
