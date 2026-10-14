# Market alerts + Brief 2.0

## Brief 2.0 (automation deliveries)
The daily brief (bell, Telegram, push) now carries, in this order: price, **expected range** ("Expected range (80% of past
moves): 12h +/-X (a%), 24h +/-Y (b%) - volatility, not a direction"), **key levels** (yesterday's high / low relative to
price, "swept" when taken), the macro alignment line, the SMC structure line (only with a clear lean) and today's high-impact
events (IST). The range uses the band validated out-of-sample on Gold and Bitcoin (`docs/research/SMC_AND_VOLATILITY_RD.md`);
it is a size of move, never a direction or a target. Helpers: `services/smc/expected-range.ts`.

## Market alerts
Per user, per instrument (7), three optional alerts - information only, never a trade call:
| kind | fires when | threshold choices |
|---|---|---|
| `level_near` | price is within N ATR of yesterday's high / low (a level not yet swept) | 0.25 / 0.5 / 1 ATR |
| `vol_high` | current ATR is above 1.3x its recent average (the engine's High regime) | fixed |
| `event_soon` | a high-impact release for the instrument's currencies is N minutes away | 15 / 30 / 60 min |

* Evaluator (pure): `services/market-alerts/alerts.ts`. Runner (DI, edge-triggered, compare-and-set, cooldown, reminders):
  `services/market-alerts/runner.ts`; production wiring `production.ts`. Same state machine as the Live Sync alerts
  (`nextTransition`): a condition is announced once, reminded only after the cooldown, silently re-armed when it clears.
* Data is fetched once per symbol per run (SMC 60 s cache, one calendar feed per currency set), however many users watch it.
  A symbol without data is skipped - never guessed.
* Cron: `GET /api/private/market-alerts/cron/run` every 5 minutes (`vercel.json`, exempt in `proxy.ts`, valid CRON_SECRET or admin).
* Delivery: bell always; Telegram / push when the user connected them (their existing "alerts" switch).
* User API: `GET/PUT/POST /api/private/market-alerts`; page `/dashboard/alerts`; nav "Market Alerts".
* Table `market_alert_rules` (additive migration `20261015200000_add_market_alert_rules`). The runner and the API tolerate the
  table being absent (runner returns zeros, API answers 503 "not available yet"), so the migration can be applied after deploy.
* Test: `npm run validate:market-alerts` (13).
