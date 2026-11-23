# AT24 Execute bridge: runbook

For the owner and for support. The design is in `EXEC-BRIDGE-PLAN-B-RD-2026-11-23.md`.

## Switches (Vercel environment variables, Production)

| Variable | Meaning |
|---|---|
| `EXEC_BRIDGE_ENABLED=true` | Turns the bridge on. Until it is on, `/api/exec/v1/poll` answers 503 DISABLED and nothing can be queued. Admin accounts only. |
| `EXEC_BRIDGE_PUBLIC=true` | Opens it to every signed-in user (set only after the demo and live tests). |
| `EXEC_MAX_LOTS` | Server-side lot cap per order (default 0.10). The EA has its own `MaxLots`. |

Environment variables reach a deployment only when it is built: after changing one, redeploy.
Emergency stop: set `EXEC_BRIDGE_ENABLED` to anything but `true` and redeploy; or revoke the token on the Live Sync page (the EA stops at once).

## Setting up one terminal

1. Live Sync page, card "AT24 Execute EA": tick the consent box, create a token (shown once).
2. Copy `AT24Execute.ex5` to the terminal's `MQL5\Experts`, refresh the Navigator.
3. Tools > Options > Expert Advisors: tick Allow WebRequest for listed URL, add `https://www.algotraders24.ai`.
4. Attach the EA to one chart: paste the token, keep `AllowLiveAccount=false` on a demo account, start with `DryRun=true`, Algo Trading on.
5. Pro Chart, Trade tab: "EA connected". Send a plan: with DryRun the result is "Refused: dry run".
6. `DryRun=false`, smallest lot, demo account: a market plan becomes "Filled", a limit plan "Limit order placed".

## Reading the results

| Status in the Trade tab | Meaning |
|---|---|
| Waiting for your EA | Queued; the EA has not asked yet (market orders live 30 s, limits as set) |
| Sent to your EA | The EA picked it up |
| Filled / Limit order placed | Placed in your terminal (ticket shown) |
| Refused | The EA or the broker refused it; the reason is shown |
| Expired / Cancelled | Not placed in time / cancelled by you while queued |
| Result not reported | The EA picked it up but its report never arrived: check the terminal's Trade tab; the order is never re-sent |

## EA inputs worth knowing

`MaxLots`, `MaxSlippagePoints`, `MaxSpreadPoints`, `MaxOpenPositions`, `MaxDailyLossPercent`, `SymbolSuffix` (for brokers that add one, for example `m`), `MagicNumber`, `DryRun`, `AllowLiveAccount`.
The EA never closes or modifies a position and never opens one that was not confirmed in the chart.

## Not done yet

MT4 version, public rollout, closing or modifying positions from the chart.
