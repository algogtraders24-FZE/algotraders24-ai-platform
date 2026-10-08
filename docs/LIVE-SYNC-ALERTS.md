# Live Sync alerts (v1) - how it works and how to switch it on

Status: built, free for everyone (owner decision 2026-10-08: the goal is selling EAs and getting users onto the platform).
Alerts only INFORM. The EA is read-only; nothing here trades or closes positions.

## What users get
Per synced account, five alert types, each with on/off, a threshold, channels (email, header bell) and a "repeat after" time:

| Type | Fires when | Default |
|---|---|---|
| Margin level is low | equity / margin x 100 is below the threshold (under 120% is marked critical) | 200% |
| Daily loss limit | equity is X% below the balance at the start of the broker day | 5% |
| Drawdown from the peak | equity is X% below its highest level of the last 30 days | 20% |
| Live Sync stopped reporting | no data for N minutes | 10 min |
| Position without a stop loss | a position has been open N minutes with no SL | 5 min |

Behaviour: edge-triggered. A breach is announced once, repeated only after the cooldown while it lasts, and resets when it clears. Re-breaching right after a reset waits for the cooldown (no flapping spam). "Send a test alert" checks delivery.

## Where it runs
- Margin / daily loss / drawdown / no-stop-loss: evaluated after every stored snapshot (EA posts about every 30 s) via `onSnapshotStored` in the ingest route using `after()`; never slows or fails ingestion.
- "Stopped reporting": nothing arrives to trigger a check, so a timer calls `POST /api/live-sync/v1/sweep` with `Authorization: Bearer <secret>` every 5 minutes. The secret is the dedicated `LIVE_SYNC_SWEEP_SECRET` (preferred, so the VPS never holds the Vercel cron secret) or the platform `CRON_SECRET`. Vercel Hobby only allows a once-a-day cron, so the timer is a scheduled task on the VPS: `frontend/scripts/ops/live-sync-alert-pinger.ps1` (`-Install` registers it).

## Code map
`services/live-sync/alerts.ts` (pure rules + state machine + validation, `scripts/validate-live-sync-alerts.ts` 40 checks) · `services/live-sync/alert-runner.ts` (DB: load numbers, evaluate, compare-and-set state, notify) · `services/notifications/NotificationService.ts` + `components/shell/NotificationBell.tsx` (the bell was an empty placeholder before) · `sendLiveSyncAlertEmail` in `EmailService.ts` · routes `/api/private/live-sync/alerts`, `/api/private/notifications`, `/api/live-sync/v1/sweep` · UI `components/live-sync/AlertsPanel.tsx` on the Live Sync page.

## To switch on (owner)
1. Apply migration `20261009150000_add_alerts_and_notifications` (two new tables: `live_sync_alert_rules`, `user_notifications`) with `prisma db execute --file ...` then `prisma migrate resolve --applied ...`.
2. (Offline alert only) Generate a random secret once (any 32+ character random string), add it in Vercel as `LIVE_SYNC_SWEEP_SECRET` (Production) and redeploy, set the SAME value on the VPS as machine env `AT24_CRON_SECRET`, then run `live-sync-alert-pinger.ps1 -Install`.
`LIVE_SYNC_ENABLED` must already be true. The older option (use the Vercel `CRON_SECRET` value instead) still works.

## Honest limits
Email delivery depends on Resend being configured (see the email status memory); the bell works regardless. Alerts are best-effort, not a guarantee, and are not a substitute for a stop loss or broker-side risk limits. Not built yet: Telegram, quiet hours, per-symbol rules.
