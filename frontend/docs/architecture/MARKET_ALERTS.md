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

## Calibration scoreboard (public: /calibration)
Every 4 hours (cron `7 */4 * * *`, `/api/private/calibration/cron/run`) the platform records the volatility range it states for each of
the 7 instruments (12h and 24h, the validated 80% band) in `range_forecasts`, one row per symbol per 4-hour slot (unique key =
idempotent). When 12h / 24h have passed the row is settled against the close of the hourly candle that ends at the horizon:
inside = |close - price then| <= half-width. A missing outcome candle (market closed, feed gap) VOIDS that horizon after 6h - it is
never counted as a success; a forecast is not issued at all when the last candle is stale (market closed). Every forecast counts, none
is deleted. The public page shows, per market and pooled: checked, share inside, Wilson 95% interval and a verdict
("Collecting data" below 30 checked; "On target" when the 80% target is inside the interval; above / below otherwise), next to the
backtest numbers that justified shipping it. Code: `services/calibration/{forecast,runner,production}.ts`. Test: `npm run validate:calibration` (10).
Additive migration `20261015300000_add_range_forecasts`; the runner and the page tolerate the table being absent.
