# Plan B: order execution through the user's own MT5 (an "Execute" EA)

Status: R&D note for the owner, 2026-11-23. Nothing is built. Written while MetaApi support has not yet answered.

## 1. The idea in plain words

The Pro Chart already produces a trade plan (entry, stop, target). Today the user cannot send it anywhere. MetaApi would run the user's MT5 in the cloud and
place the order for us, but it needs the user's trading password, it costs money per connected account, and right now our own two test accounts do not connect.

Plan B does the same job without any cloud terminal: a small **Expert Advisor (EA)** runs inside the user's own MT5. The user presses "Send to my MT5" in the chart
and confirms; our server keeps that order in a queue for a short time; the EA, which asks our server for work every few seconds, picks it up and places it in the
user's own terminal; the EA then reports the result back. The password never leaves the user's computer.

## 2. How it would work, step by step

1. In the chart, the user presses **Place order** on a plan, reviews it (symbol, side, lots, stop, target) and presses **Confirm**. This is the only way an order can start.
2. The server stores an `ExecOrder`: user, which of the user's MT5 accounts, symbol, side, market or limit, price, stop, target, lots, an expiry time, and the exact plan the user saw.
3. The EA calls `POST /api/exec/v1/poll` every 2 to 3 seconds (WebRequest, https, port 443). The answer is either "nothing" or one order.
4. The EA runs its **own checks** (section 4). If they pass it sends the order with `OrderSend`; if not it refuses and says why.
5. The EA calls `POST /api/exec/v1/report` with the result (ticket, fill price, return code or the refusal reason). The chart shows "Sent / Filled / Refused: reason".
6. Open positions and balance already arrive through the existing Live Sync snapshots, so the Trade tab needs no new read path.

## 3. What we can reuse from Live Sync (already built and verified)

| Piece | Reuse |
|---|---|
| Device tokens (hashed at rest, shown once, revocable, 5 per user, consent before creation) | Same mechanism, new scope `exec` |
| `handshake`, per-device rate limit, kill-switch env flag, fail-closed gates | Same pattern for `poll` and `report` |
| `accountKey` (hash of login, server, salt): no account number is stored | Same, so an order is tied to one of the user's synced accounts |
| EA build chain (MQL5 `.ex5`, MQL4 `.ex4`, source shipped, validation scripts) | Same chain; the script is inverted: trade calls are allowed only in one reviewed function |
| Live Sync page, downloads, setup guide, WebRequest allow-list instructions | Same page, one more card |

New: table `ExecOrder`, three endpoints (`poll`, `report`, `cancel`), the Trade-tab panel, EA v2 with trade functions, and tests.

## 4. Safety design (defence in depth: the server AND the EA each refuse bad orders)

| Rule | Where |
|---|---|
| An order exists only after the user's explicit Confirm; the server records the time and the plan snapshot. No automatic orders in this plan. | Server |
| Every order has an expiry (market orders about 30 s, limit orders as the user sets, at most 24 h). The EA never executes an expired order. | Server and EA |
| Each order has a unique id; the EA remembers executed ids (terminal global variables) so a repeated poll cannot place it twice. | EA |
| A stop loss is mandatory; lots are capped by the EA's own input `MaxLots` (default 0.10), whatever the server says. | EA |
| Live accounts are refused unless the user switched `AllowLiveAccount=true` in the EA inputs (same as Live Sync). | EA |
| Symbol allow-list and suffix mapping (`BTCUSD` vs `BTCUSDm`) are EA inputs; unknown symbols are refused. | EA |
| Price check at execution: a market order is refused if the price moved more than `MaxSlippagePoints` from the plan; a limit order is refused if it would fill immediately at a worse price. | EA |
| `MaxOpenPositions`, daily loss stop (equity drawdown for the day), spread filter. | EA |
| Kill switch (env flag) and token revoke stop everything at once; every order and result is in an audit log the user can read. | Server |
| The source is shipped; a script scans it and allows trade functions only inside the one reviewed function. | Build |

## 5. Plan B against MetaApi

| | MetaApi (cloud terminal) | Execute EA (user's own MT5) |
|---|---|---|
| Trading password | Given to MetaApi through our form | Never leaves the user's PC |
| Cost to us | One-time add fee and hosting for each connected account, every month | Nothing per user (our server only) |
| Needs the user's terminal running | No (runs in their cloud) | **Yes**: MT5 open and logged in (the user can use their own VPS) |
| Setup for the user | Type login, password, server | Install the EA, allow our URL, paste a token |
| Brokers | Whatever MetaApi supports (Exness is not connecting for us now) | Any broker that allows EAs |
| Latency | Cloud call, roughly a second or more | Polling every 2 to 3 s plus the order itself: fine for click trading, not for scalping |
| Platforms | MT4 and MT5 | MT5 first, MT4 as a port |
| Who is down if it fails | MetaApi and the broker link | The user's terminal and internet |

## 6. Limits and unknowns, honestly

- `WebRequest` is synchronous and blocks the EA for up to the timeout; fine on a timer, but the EA must not poll faster than every 2 seconds.
- It does not run in the Strategy Tester, so it is verified only on a real demo terminal (same as Live Sync).
- Windows terminals with "Algo trading" switched on and the allow-list entry added: a user who misses a step sees a clear message on the chart, not a silent failure.
- A plan can be stale when the user confirms; the EA's price check is what protects against that.
- Netting accounts and partial closes need their own handling (not in the first version, same as Live Sync).
- Broker rules (minimum stop distance, lot step, trading hours) can refuse an order; the EA reports the broker's reason.

## 7. The stance question (this needs your decision, and a lawyer)

The Live Sync spec says "AT24 never places or modifies orders". Plan B changes that in practice: our server queues an order and the user's terminal executes it.
It is always the user's own explicit click and the user's own terminal, but it is closer to execution than anything we have built, and the copier notes already say
"lawyer first". Before building: confirm with a lawyer what disclaimers, terms and consent wording are needed, and keep the wording "your order, placed by your EA, only when you confirm".
We do not give advice or promise results; the plan stays a measured plan.

## 8. Effort and order of work

| Stage | What | Rough size |
|---|---|---|
| X0 | Lawyer answer, consent and terms wording | outside engineering |
| X1 | Server: `ExecOrder` table (additive migration), `poll`, `report`, `cancel`, auth scope `exec`, rate limit, kill switch, tests | 2 to 3 days |
| X2 | EA v2 for MT5 with the safety rules above, compile and scan scripts | 3 to 4 days |
| X3 | Trade-tab panel ("Send to my MT5"), status updates, audit list | 1 to 2 days |
| X4 | Test on a real DEMO terminal (needs you: attach the EA, allow the URL, paste a token); then a live-account test with the smallest lot | 1 day with you |
| X5 | MT4 port, then docs and a setup guide | 2 to 3 days |

I can build and test X1 to X3 and compile the EA; only X4 needs your terminal.

## 9. Recommendation

Keep waiting for MetaApi in parallel (a different-broker demo will show whether MetaApi itself works). Do not promise "MT5 connect" to users until one route is proven.
If MetaApi works with other brokers but not Exness, offer both: MetaApi for supported brokers, the Execute EA for everyone else. If MetaApi does not work at all, Plan B becomes the main route.

Decisions for you: (1) Is the stance change acceptable once a lawyer agrees? (2) MT5 first, MT4 later? (3) Start with X1 and X2 now on the demo only?
